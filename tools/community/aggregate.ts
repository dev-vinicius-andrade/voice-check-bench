// Builds public/community/mics.json from the "mic-result" issues (SPEC "Community results via GitHub issues").
// Run: npm run community:aggregate            (GitHub REST API; GITHUB_TOKEN optional, raises the rate limit)
//      npm run community:aggregate -- --from-file issues.json   (offline: a JSON array of { body } objects)
// Env: COMMUNITY_REPO overrides the repo from src/community/types.ts (e.g. a fork).
import { readFile, writeFile } from 'node:fs/promises'
import { aggregate } from '../../src/community/aggregate'
import { COMMUNITY_LABEL, COMMUNITY_REPO, type CommunityIndex, type CommunitySummary } from '../../src/community/types'
import { extractSummaryFromIssueBody, parseSummary } from '../../src/community/validate'

interface IssueLike {
  body?: string | null
  pull_request?: unknown
}

const OUT = new URL('../../public/community/mics.json', import.meta.url)
const PER_PAGE = 100
const MAX_PAGES = 50

const repo = process.env.COMMUNITY_REPO || COMMUNITY_REPO
const source = `https://github.com/${repo}/issues?q=label%3A${encodeURIComponent(COMMUNITY_LABEL)}`

async function fetchIssues(): Promise<IssueLike[]> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'voice-check-bench',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  const all: IssueLike[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `https://api.github.com/repos/${repo}/issues?labels=${encodeURIComponent(COMMUNITY_LABEL)}&state=all&per_page=${PER_PAGE}&page=${page}`
    const res = await fetch(url, { headers })
    if (!res.ok) throw new Error(`GitHub API ${res.status} ${res.statusText} for ${url}: ${await res.text()}`)
    const batch = (await res.json()) as IssueLike[]
    all.push(...batch)
    if (batch.length < PER_PAGE) break
  }
  return all
}

async function readIssuesFile(path: string): Promise<IssueLike[]> {
  const data: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (!Array.isArray(data)) throw new Error(`${path}: expected a JSON array of { body } objects`)
  return data as IssueLike[]
}

/** The stored index without its timestamp, to skip rewriting when nothing but `generated` would change. */
const comparable = (i: Pick<CommunityIndex, 'version' | 'source' | 'reports' | 'mics'>): string =>
  JSON.stringify({ version: i.version, source: i.source, reports: i.reports, mics: i.mics })

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const fileIdx = args.indexOf('--from-file')
  const fromFile = fileIdx >= 0 ? args[fileIdx + 1] : undefined
  if (fileIdx >= 0 && !fromFile) throw new Error('--from-file needs a path')

  const issues = (fromFile ? await readIssuesFile(fromFile) : await fetchIssues()).filter((i) => !i.pull_request)
  const valid = issues
    .map((i) => parseSummary(extractSummaryFromIssueBody(i.body ?? '')))
    .filter((s): s is CommunitySummary => s !== null)
  const index = aggregate(valid, new Date(), source)

  let previous: CommunityIndex | null = null
  try {
    previous = JSON.parse(await readFile(OUT, 'utf8')) as CommunityIndex
  } catch {
    previous = null
  }
  const unchanged = previous !== null && comparable(previous) === comparable(index)
  if (!unchanged) await writeFile(OUT, `${JSON.stringify(index, null, 2)}\n`, 'utf8')

  console.log(`source: ${fromFile ?? `https://api.github.com/repos/${repo}/issues (label ${COMMUNITY_LABEL})`}`)
  console.log(`issues: ${issues.length}, valid summaries: ${valid.length}, reports used: ${index.reports}, mics: ${index.mics.length}`)
  for (const m of index.mics) console.log(`  ${m.model}: ${m.reports} report(s), raw SNR median ${m.rawSnr.median} dB`)
  console.log(unchanged ? 'public/community/mics.json unchanged' : 'wrote public/community/mics.json')
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
