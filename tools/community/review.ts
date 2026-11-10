// Issue checker for "mic-result" issues (SPEC "Community results via GitHub issues", "Automatic checks").
// Run: ISSUE_NUMBER=12 GITHUB_TOKEN=... npm run community:review    (labels, comments, closes/reopens issue #12)
//      npm run community:review -- --dry-run                         (reads only, prints what it would do)
//      npm run community:review                                      (no ISSUE_NUMBER: prints every verdict, writes nothing)
// Env: COMMUNITY_REPO overrides the repo from src/community/types.ts (e.g. a fork).
// Reviews all issues (so duplicates and replacements are seen) but only changes the target issue.
// `rejected` is set by hand only: such issues are left alone, and the label is never created or removed here.
import { REVIEW_MARKER, reviewComment, reviewIssues } from '../../src/community/review'
import type { COMMUNITY_REVIEW_LABELS, ReviewVerdict } from '../../src/community/types'
import { api, apiList, BOT_LOGIN, fetchIssues, loadAliases, repo, toCommunityIssue, type ApiIssue } from './github'

type BotLabel = Exclude<keyof typeof COMMUNITY_REVIEW_LABELS, 'rejected'>
const BOT_LABELS: Record<BotLabel, { color: string; description: string }> = {
  accepted: { color: '0e8a16', description: 'Mic result checked and counted in the community stats' },
  invalid: { color: 'e4e669', description: 'Mic result that could not be counted (see the bot comment)' },
  duplicate: { color: 'cfd3d7', description: 'Same mic result as an earlier issue' },
}

interface ApiComment {
  id: number
  body?: string
  user?: { login?: string } | null
}

const dryRun = process.argv.includes('--dry-run')

/** Runs a write call, or only prints it with --dry-run. */
async function write(what: string, call: () => Promise<unknown>): Promise<void> {
  console.log(`${dryRun ? '[dry-run] would ' : ''}${what}`)
  if (!dryRun) await call()
}

function describe(n: number, v: ReviewVerdict): string {
  switch (v.kind) {
    case 'accepted':
      return `#${n} accepted: ${v.mic.key} (${JSON.stringify(v.mic.model)}, ${v.mic.how})${v.replaces !== null ? `, replaces #${v.replaces}` : ''}`
    case 'invalid':
      return `#${n} invalid: ${v.problem}`
    case 'duplicate':
      return `#${n} duplicate of #${v.of}`
    case 'rejected':
      return `#${n} rejected (set by hand)`
  }
}

async function ensureLabel(name: BotLabel): Promise<void> {
  const found = await api('GET', `/labels/${encodeURIComponent(name)}`, undefined, [404])
  if (found) return
  await write(`create label "${name}"`, () => api('POST', '/labels', { name, ...BOT_LABELS[name] }))
}

async function setLabels(n: number, current: string[], wanted: BotLabel): Promise<void> {
  if (!current.includes(wanted)) {
    await ensureLabel(wanted)
    await write(`add label "${wanted}" to #${n}`, () => api('POST', `/issues/${n}/labels`, { labels: [wanted] }))
  }
  for (const other of Object.keys(BOT_LABELS) as BotLabel[]) {
    if (other === wanted || !current.includes(other)) continue
    await write(`remove label "${other}" from #${n}`, () =>
      api('DELETE', `/issues/${n}/labels/${encodeURIComponent(other)}`, undefined, [404]),
    )
  }
}

async function upsertComment(n: number, body: string): Promise<void> {
  const comments = await apiList<ApiComment>(`/issues/${n}/comments`)
  const own = comments.find((c) => c.user?.login === BOT_LOGIN && c.body?.startsWith(REVIEW_MARKER))
  if (!own) return write(`comment on #${n}`, () => api('POST', `/issues/${n}/comments`, { body }))
  if (own.body?.replace(/\r\n/g, '\n') === body) return void console.log(`comment on #${n} already up to date`)
  await write(`update comment ${own.id} on #${n}`, () => api('PATCH', `/issues/comments/${own.id}`, { body }))
}

async function setState(n: number, issue: ApiIssue, v: ReviewVerdict): Promise<void> {
  const closed = issue.state === 'closed'
  if ((v.kind === 'invalid' || v.kind === 'duplicate') && !closed) {
    await write(`close #${n} as not planned`, () => api('PATCH', `/issues/${n}`, { state: 'closed', state_reason: 'not_planned' }))
  } else if (v.kind === 'accepted' && closed) {
    // only undo the bot's own close; an issue a person closed stays closed
    if (issue.closed_by?.login === BOT_LOGIN) await write(`reopen #${n}`, () => api('PATCH', `/issues/${n}`, { state: 'open' }))
    else console.log(`#${n} was closed by ${issue.closed_by?.login ?? 'someone'}; left closed`)
  }
}

async function main(): Promise<void> {
  const raw = process.env.ISSUE_NUMBER?.trim()
  const target = raw ? Number(raw) : null
  if (target !== null && (!Number.isInteger(target) || target <= 0)) throw new Error(`ISSUE_NUMBER must be a positive integer, got ${JSON.stringify(raw)}`)

  const issues = (await fetchIssues()).map(toCommunityIssue)
  const verdicts = reviewIssues(issues, await loadAliases())
  console.log(`repo: ${repo}, mic-result issues: ${issues.length}${dryRun ? ' (dry run)' : ''}`)

  if (target === null) {
    for (const [n, v] of verdicts) console.log(describe(n, v))
    return
  }
  const verdict = verdicts.get(target)
  if (!verdict) return void console.log(`#${target} is not a mic-result issue; nothing to do`)
  console.log(describe(target, verdict))
  if (verdict.kind === 'rejected') return void console.log(`#${target} is rejected; left alone`)

  const issue = await api<ApiIssue>('GET', `/issues/${target}`)
  if (!issue) throw new Error(`#${target} not found`)
  const labels = toCommunityIssue(issue, 0).labels
  await setLabels(target, labels, verdict.kind)
  await upsertComment(target, reviewComment(verdict, repo))
  await setState(target, issue, verdict)
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
