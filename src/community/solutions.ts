// Shared settings (CommunityMicStats.solutions, v1.2): flatten, filter and sort for the Community page. Framework-free.
import type { VoiceStyle } from '../types'
import { COMMUNITY_REPO, type CommunityMicStats, type CommunitySolution } from './types'

export const SOLUTION_STYLES = ['natural', 'warm', 'clear', 'bright'] as const satisfies readonly VoiceStyle[]
export const SOLUTION_ROOMS = ['any', 'noisy', 'quiet'] as const
export const SOLUTION_SORTS = ['votes', 'gain', 'newest'] as const

export type SolutionRoom = (typeof SOLUTION_ROOMS)[number]
export type SolutionSort = (typeof SOLUTION_SORTS)[number]

export interface SolutionFilter {
  /** micKey, 'all', or null = not chosen yet (the page picks the person's own mic when it has solutions). */
  mic: string | null
  style: VoiceStyle | 'any'
  room: SolutionRoom
  sort: SolutionSort
}

export const DEFAULT_SOLUTION_FILTER: SolutionFilter = { mic: null, style: 'any', room: 'any', sort: 'votes' }

/** A solution with the mic it was shared for. */
export interface SolutionItem extends CommunitySolution {
  micKey: string
  model: string
}

/** The solution's issue on GitHub (where people vote with 👍). */
export const issueUrl = (issue: number): string => `https://github.com/${COMMUNITY_REPO}/issues/${issue}`

/** Every solution of every mic (older index files have none). */
export const collectSolutions = (mics: readonly CommunityMicStats[]): SolutionItem[] =>
  mics.flatMap((m) => (m.solutions ?? []).map((s) => ({ ...s, micKey: m.key, model: m.model })))

/** Mics that have at least one solution, by model name. */
export const micsWithSolutions = (mics: readonly CommunityMicStats[]): { key: string; model: string }[] =>
  mics
    .filter((m) => (m.solutions?.length ?? 0) > 0)
    .map((m) => ({ key: m.key, model: m.model }))
    .sort((a, b) => a.model.localeCompare(b.model))

/** The mic filter in effect: a chosen mic that still has solutions, else `own` when it has solutions, else 'all'. */
export function effectiveMic(chosen: string | null, own: string, keys: readonly string[]): string {
  if (chosen === 'all' || (chosen !== null && keys.includes(chosen))) return chosen
  return keys.includes(own) ? own : 'all'
}

const byIssue = (a: SolutionItem, b: SolutionItem): number => b.issue - a.issue
const COMPARE: Record<SolutionSort, (a: SolutionItem, b: SolutionItem) => number> = {
  votes: (a, b) => b.votes - a.votes || byIssue(a, b),
  // biggest improvement first, solutions without a processed take last
  gain: (a, b) => (b.snrGain ?? -Infinity) - (a.snrGain ?? -Infinity) || b.votes - a.votes || byIssue(a, b),
  newest: byIssue,
}

/** Solutions matching the filter (mic must already be resolved by effectiveMic), sorted. */
export function filterSolutions(items: readonly SolutionItem[], f: SolutionFilter & { mic: string }): SolutionItem[] {
  return items
    .filter(
      (s) =>
        (f.mic === 'all' || s.micKey === f.mic) &&
        (f.style === 'any' || s.style === f.style) &&
        (f.room === 'any' || s.noisyRoom === (f.room === 'noisy')),
    )
    .sort(COMPARE[f.sort])
}

const oneOf = <T extends string>(list: readonly T[], v: unknown, fallback: T): T =>
  typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : fallback

/** A stored filter (untrusted JSON) with every bad field replaced by the default. */
export function parseSolutionFilter(raw: unknown): SolutionFilter {
  const o = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    mic: typeof o.mic === 'string' && o.mic ? o.mic : null,
    style: oneOf<VoiceStyle | 'any'>(['any', ...SOLUTION_STYLES], o.style, 'any'),
    room: oneOf(SOLUTION_ROOMS, o.room, 'any'),
    sort: oneOf(SOLUTION_SORTS, o.sort, 'votes'),
  }
}
