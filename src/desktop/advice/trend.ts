// Tone trend for "Try this" (SPEC "Desktop app (v2.0)" → Tuning): a single live window's tone swings several dB from
// one window to the next (the sign even flips), so tone advice only uses a band once many fresh windows agree on it.
// Pure, framework-free: every call returns a new state.
import type { HeldMetrics } from '../../live/hold'
import { LIVE_WINDOW_SEC } from '../../live/types'

/** Windows older than this (ms, from the newest one) leave the trend. */
export const TREND_KEEP_MS = 30_000
/** The windows of a band must span this much (ms) before it counts; with the 4 s window that is ~15 s of audio. */
export const STABLE_SPAN_MS = 11_000
/** At least this many finite readings of a band. */
export const STABLE_MIN_VALUES = 8
/** At least this share of the readings has the sign of their median. */
export const STABLE_SHARE = 0.8

export interface TrendEntry {
  /** held.fx.heardAtMs of the window (the caller's clock, ms). */
  atMs: number
  /** held.fx.tone of that window (deviation from the goal per BANDS index, dB). */
  tone: readonly number[]
}

export interface ToneTrend {
  /** The notBeforeMs the entries were collected for: a new one (a change was made) starts over. */
  since: number | undefined
  /** Oldest first, all heard at or after `since`, each window once. */
  entries: readonly TrendEntry[]
}

export const emptyTrend = (since?: number): ToneTrend => ({ since, entries: [] })

/**
 * Adds the newest held window. Starts over when notBeforeMs differs from the trend's; skips windows not heard yet,
 * heard before notBeforeMs, or already in (held values repeat between windows). A clock going backwards (the engine
 * restarted) also starts over. Keeps the windows within TREND_KEEP_MS of the newest.
 */
export function pushTrend(trend: ToneTrend, held: HeldMetrics, notBeforeMs?: number): ToneTrend {
  const base = trend.since === notBeforeMs ? trend : emptyTrend(notBeforeMs)
  const at = held.fx.heardAtMs
  if (at === null || (notBeforeMs !== undefined && at < notBeforeMs)) return base
  const last = base.entries.at(-1)
  if (last && at === last.atMs) return base
  const kept = last && at < last.atMs ? [] : base.entries.filter((e) => e.atMs >= at - TREND_KEEP_MS)
  return { since: notBeforeMs, entries: [...kept, { atMs: at, tone: [...held.fx.tone] }] }
}

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export interface TrendTone {
  /** Same indexing as held.fx.tone: the median of a stable band, NaN where the band is not stable (yet). */
  tone: number[]
  /** Seconds of audio behind the trend (entries' span + one window), rounded; 0 while empty. */
  evidenceSec: number
}

/**
 * The stable tone: a band counts when the entries span ≥ STABLE_SPAN_MS, it has ≥ STABLE_MIN_VALUES finite readings
 * and ≥ STABLE_SHARE of them share the sign of their median; its value is that median.
 */
export function trendTone(trend: ToneTrend): TrendTone {
  const { entries } = trend
  const first = entries[0]
  const last = entries.at(-1)
  if (!first || !last) return { tone: [], evidenceSec: 0 }
  const span = last.atMs - first.atMs
  const bands = Math.max(...entries.map((e) => e.tone.length))
  const tone = Array.from({ length: bands }, (_, i) => {
    if (span < STABLE_SPAN_MS) return NaN
    const xs = entries.map((e) => e.tone[i]).filter((v): v is number => Number.isFinite(v))
    if (xs.length < STABLE_MIN_VALUES) return NaN
    const med = median(xs)
    const same = xs.filter((v) => Math.sign(v) === Math.sign(med)).length
    return same >= STABLE_SHARE * xs.length ? med : NaN
  })
  return { tone, evidenceSec: Math.round(span / 1000 + LIVE_WINDOW_SEC) }
}
