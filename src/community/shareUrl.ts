// Pre-filled "new issue" link for sharing a CommunitySummary (SPEC "Community results via GitHub issues"). Pure.
import { COMMUNITY_REPO, COMMUNITY_SUMMARY_FIELD, COMMUNITY_TEMPLATE, type CommunitySummary } from './types'

/** Browsers and GitHub handle URLs well below this length. */
export const MAX_SHARE_URL = 7500

const MAX_TONES = 3

type Take = CommunitySummary['takes'][number]
type Shrink = (s: CommunitySummary) => CommunitySummary

const mapTakes = (s: CommunitySummary, f: (a: Take['analysis']) => Take['analysis']): CommunitySummary => ({
  ...s,
  takes: s.takes.map((t) => ({ ...t, analysis: f(t.analysis) })),
})

/** Rounds every finite number in a JSON-like value to an integer. */
function roundDeep<T>(v: T): T {
  if (typeof v === 'number') return (Number.isFinite(v) ? Math.round(v) : v) as T
  if (Array.isArray(v)) return v.map(roundDeep) as T
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, roundDeep(x)])) as T
  }
  return v
}

/** Drops the human-readable text in the suggestion (ReaFIR steps, alternatives, EQ "why"): the aggregator never reads it. */
const dropSuggestionText: Shrink = (s) =>
  s.suggestion
    ? {
        ...s,
        suggestion: {
          ...s.suggestion,
          gainHint: '',
          noiseHint: '',
          noiseReduction: s.suggestion.noiseReduction ? { ...s.suggestion.noiseReduction, steps: [], alternatives: [] } : null,
          eq: s.suggestion.eq.map((e) => ({ ...e, why: '' })),
        },
      }
    : s

/**
 * Progressively smaller versions: no suggestion prose, integers, at most 3 tones per take.
 * rel/bandSnr are never dropped: the aggregator needs them (a report without rel is rejected).
 */
const STEPS: Shrink[] = [
  dropSuggestionText,
  (s) => roundDeep(s),
  (s) => mapTakes(s, (a) => ({ ...a, tones: a.tones.slice(0, MAX_TONES) })),
]

const base = (model: string): string =>
  `https://github.com/${COMMUNITY_REPO}/issues/new?template=${COMMUNITY_TEMPLATE}` +
  `&title=${encodeURIComponent(`Mic result: ${model}`)}`

const withSummary = (model: string, s: CommunitySummary): string =>
  `${base(model)}&${COMMUNITY_SUMMARY_FIELD}=${encodeURIComponent(JSON.stringify(s))}`

/**
 * Link to the community issue form pre-filled with the minified summary. Shrinks the summary when the link would
 * exceed MAX_SHARE_URL; if it still does, returns the form without the summary and truncated = true.
 */
export function buildShareUrl(summary: CommunitySummary): { url: string; truncated: boolean } {
  const model = summary.mic.model.trim()
  let s = summary
  let url = withSummary(model, s)
  for (const shrink of STEPS) {
    if (url.length <= MAX_SHARE_URL) return { url, truncated: false }
    s = shrink(s)
    url = withSummary(model, s)
  }
  if (url.length <= MAX_SHARE_URL) return { url, truncated: false }
  return { url: base(model), truncated: true }
}
