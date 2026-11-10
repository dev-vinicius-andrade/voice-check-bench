// Issue checker (tools/community/review.ts) and aggregation input: one verdict per mic-result issue. Pure.
// Verdicts depend only on the issues themselves and the hand-set `rejected` label, never on labels the bot sets,
// so the checker and the aggregator always agree. Issue bodies are untrusted.
import { displayModel, hasRawControl, type ReviewedReport } from './aggregate'
import { matchMic, type KnownMic } from './micMatch'
import {
  COMMUNITY_REVIEW_LABELS,
  type CommunityIssue,
  type CommunitySummary,
  type MicAliases,
  type ReviewVerdict,
} from './types'
import { parseSummaryDetailed } from './validate'

/** Hidden first line of the checker's own comment, so it edits that comment instead of posting new ones. */
export const REVIEW_MARKER = '<!-- vcb-review -->'
export const COMMUNITY_PAGE_URL = 'https://voicecb.app.andradev.io/#/community'

/** JSON with sorted object keys; non-finite numbers as null (like JSON.stringify), undefined members skipped. */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : stableStringify(x))).join(',')}]`
  if (typeof v === 'object' && v !== null) {
    const o = v as Record<string, unknown>
    const members = Object.keys(o)
      .sort()
      .filter((k) => o[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    return `{${members.join(',')}}`
  }
  return JSON.stringify(v) ?? 'null'
}

const FNV_OFFSET = 0xcbf29ce484222325n
const FNV_PRIME = 0x100000001b3n
const MASK_64 = 0xffffffffffffffffn

/** 64-bit FNV-1a of the stable JSON of a parsed summary (16 hex chars). Same summary → same hash. */
export function summaryHash(s: CommunitySummary): string {
  let h = FNV_OFFSET
  for (const byte of new TextEncoder().encode(stableStringify(s))) {
    h = ((h ^ BigInt(byte)) * FNV_PRIME) & MASK_64
  }
  return h.toString(16).padStart(16, '0')
}

interface Counting {
  issue: number
  author: string
  key: string
  model: string
  hash: string
}

function knownMics(counting: ReadonlyMap<number, Counting>): KnownMic[] {
  const groups = new Map<string, string[]>()
  for (const c of counting.values()) groups.set(c.key, [...(groups.get(c.key) ?? []), c.model])
  return [...groups].map(([key, models]) => ({ key, model: displayModel(key, models), reports: models.length }))
}

const invalid = (problem: string): ReviewVerdict => ({ kind: 'invalid', problem })

/**
 * Verdict per issue number. Issues are processed in ascending number order, so the result does not depend on
 * the input order: `rejected` label → rejected; unparseable / no raw control take / model without letters or
 * digits → invalid; same summary as a counting issue → duplicate; else accepted, matched against the mics
 * accepted so far. A newer report by the same author for the same mic replaces the older one.
 */
export function reviewIssues(issues: readonly CommunityIssue[], aliases: MicAliases): Map<number, ReviewVerdict> {
  const verdicts = new Map<number, ReviewVerdict>()
  const counting = new Map<number, Counting>()
  const byHash = new Map<string, number>()
  for (const issue of [...issues].sort((a, b) => a.number - b.number)) {
    if (issue.labels.includes(COMMUNITY_REVIEW_LABELS.rejected)) {
      verdicts.set(issue.number, { kind: 'rejected' })
      continue
    }
    const parsed = parseSummaryDetailed(issue.body)
    if (!parsed.ok) {
      verdicts.set(issue.number, invalid(parsed.problem))
      continue
    }
    const summary = parsed.summary
    if (!hasRawControl(summary)) {
      verdicts.set(issue.number, invalid('Summary has no raw control take (2, 8 or 15 cm)'))
      continue
    }
    const hash = summaryHash(summary)
    const of = byHash.get(hash)
    if (of !== undefined) {
      verdicts.set(issue.number, { kind: 'duplicate', of })
      continue
    }
    const mic = matchMic(summary.mic.model, knownMics(counting), aliases)
    if (!mic.key) {
      verdicts.set(issue.number, invalid('Summary has a missing or invalid value: mic.model (no letters or digits)'))
      continue
    }
    const earlier = issue.author ? [...counting.values()].find((c) => c.author === issue.author && c.key === mic.key) : undefined
    if (earlier) {
      counting.delete(earlier.issue)
      byHash.delete(earlier.hash)
    }
    counting.set(issue.number, { issue: issue.number, author: issue.author, key: mic.key, model: summary.mic.model, hash })
    byHash.set(hash, issue.number)
    verdicts.set(issue.number, { kind: 'accepted', mic, replaces: earlier?.issue ?? null })
  }
  return verdicts
}

/** Aggregation input: the accepted issues with their parsed summaries (others are left out). */
export function reviewedReports(issues: readonly CommunityIssue[], verdicts: ReadonlyMap<number, ReviewVerdict>): ReviewedReport[] {
  return issues.flatMap((issue): ReviewedReport[] => {
    const verdict = verdicts.get(issue.number)
    if (verdict?.kind !== 'accepted') return []
    const parsed = parseSummaryDetailed(issue.body)
    return parsed.ok ? [{ issue: issue.number, votes: issue.votes, summary: parsed.summary, verdict }] : []
  })
}

/**
 * Untrusted model name as an inline code span: no HTML, markdown, @mentions or autolinks render inside it.
 * Backticks and control characters are replaced, whitespace collapsed.
 */
export function codeSpan(text: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = text.replace(/`/g, "'").replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim()
  return `\`${clean || '?'}\``
}

const issueLink = (n: number, repo: string): string => `[#${n}](https://github.com/${repo}/issues/${n})`

/** English markdown for the checker's comment on the issue. Only the matched mic model comes from the issue. */
export function reviewComment(v: ReviewVerdict, repo: string): string {
  const lines = [REVIEW_MARKER]
  switch (v.kind) {
    case 'accepted': {
      const model = `**${codeSpan(v.mic.model)}**`
      const counted =
        v.mic.how === 'new'
          ? `It is counted for ${model} (new mic).`
          : v.mic.how === 'exact'
            ? `It is counted for ${model}.`
            : `Your model name was matched to existing mic ${model}, and the result is counted for it.`
      lines.push(`Thanks for sharing your result! ${counted}`)
      if (v.replaces !== null) lines.push('', `It replaces your earlier result ${issueLink(v.replaces, repo)}: only your newest result for this mic counts.`)
      lines.push(
        '',
        `Others can react with 👍 to this issue: reactions rank the shared settings on the [Community page](${COMMUNITY_PAGE_URL}).`,
      )
      break
    }
    case 'invalid':
      lines.push(
        `This result could not be counted: ${v.problem}.`,
        '',
        'Edit the issue to fix it and the check runs again.',
      )
      break
    case 'duplicate':
      lines.push(`This issue has the same results as ${issueLink(v.of, repo)}, so it is closed as a duplicate.`)
      break
    case 'rejected':
      lines.push('This result was rejected by a maintainer and is not counted.')
      break
  }
  return `${lines.join('\n')}\n`
}
