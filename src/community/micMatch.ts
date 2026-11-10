// Matches a reported mic model to the mics already known (issue checker and aggregation). Pure, framework-free.
// Order: alias (tools/community/aliases.json) → exact micKey → fuzzy (typo / extra words) → new mic.
import { micKey, type MicAliases, type MicMatch } from './types'

export interface KnownMic {
  key: string
  /** Display name. */
  model: string
  reports: number
}

/** Edit distance (insert / delete / substitute, each 1). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}

const digits = (key: string): string => key.replace(/\D/g, '')

/** (a) a typo: distance ≤1 when both keys have ≥5 chars, ≤2 when both have ≥8; never when the digits differ (SM57 ≠ SM58). */
function typoMatch(a: string, b: string): boolean {
  const len = Math.min(a.length, b.length)
  if (len < 5 || digits(a) !== digits(b)) return false
  return levenshtein(a, b) <= (len >= 8 ? 2 : 1)
}

/** (b) extra words: the shorter key (≥4 chars, with a digit) is inside the longer one ("k688" ⊂ "fifinek688"). */
function containsMatch(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  return short.length >= 4 && /\d/.test(short) && short !== long && long.includes(short)
}

const isDistinct = (a: string, b: string, aliases: MicAliases): boolean =>
  aliases.distinct.some(([x, y]) => (x === a && y === b) || (x === b && y === a))

/**
 * How `model` counts. An empty micKey comes back as { key: '' } and the caller treats it as invalid.
 * Several fuzzy candidates: the one with most reports, then the lowest key.
 */
export function matchMic(model: string, known: readonly KnownMic[], aliases: MicAliases): MicMatch {
  const key = micKey(model)
  const own: MicMatch = { key, model: model.trim(), how: 'new' }
  if (!key) return own
  const byKey = (k: string) => known.find((m) => m.key === k)

  const alias = Object.hasOwn(aliases.aliases, key) ? aliases.aliases[key] : undefined
  if (alias && alias !== key) return { key: alias, model: byKey(alias)?.model ?? own.model, how: 'alias' }

  const exact = byKey(key)
  if (exact) return { key, model: exact.model, how: 'exact' }

  const fuzzy = known
    .filter((m) => m.key && !isDistinct(key, m.key, aliases) && (typoMatch(key, m.key) || containsMatch(key, m.key)))
    .sort((a, b) => b.reports - a.reports || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))[0]
  if (fuzzy) return { key: fuzzy.key, model: fuzzy.model, how: 'fuzzy' }
  return own
}
