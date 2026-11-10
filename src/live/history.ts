// Live history (SPEC "Live tuning (v1.3)"): the last HISTORY_MS of live updates, one point per update, plus "I changed
// something" markers. Pure functions over an immutable value, framework-free; bounded by time and by HISTORY_MAX_POINTS.
import type { Msg } from '../plain/types'
import { isHeard } from './hold'
import type { LiveMetrics } from './types'

/** How far back the history reaches, ms. */
export const HISTORY_MS = 60_000
/** Hard cap on points, whatever the update rate. */
export const HISTORY_MAX_POINTS = 600

export interface HistoryPoint {
  /** Update time, ms (the caller's clock). */
  t: number
  /** Window values as measured (NaN when not measurable; raw NaN without a raw mic). */
  rawSpeechDb: number
  fxSpeechDb: number
  rawPauseDb: number
  fxPauseDb: number
  /** The window had at least MIN_TALK_SEC of talk. */
  talking: boolean
}

export interface ChangeMarker {
  t: number
  label: Msg
}

export interface LiveHistory {
  points: readonly HistoryPoint[]
  markers: readonly ChangeMarker[]
}

export const EMPTY_HISTORY: LiveHistory = { points: [], markers: [] }

function trim(h: LiveHistory, now: number, windowMs: number): LiveHistory {
  const from = now - windowMs
  const keep = <T extends { t: number }>(a: readonly T[]): readonly T[] => {
    let i = 0
    while (i < a.length && !(a[i].t > from)) i++
    return i ? a.slice(i) : a
  }
  const points = keep(h.points)
  return { points: points.length > HISTORY_MAX_POINTS ? points.slice(points.length - HISTORY_MAX_POINTS) : points, markers: keep(h.markers) }
}

/** Adds the update at time t and drops whatever is older than windowMs before it. */
export function pushHistory(h: LiveHistory, m: LiveMetrics, t: number, windowMs = HISTORY_MS): LiveHistory {
  const p: HistoryPoint = {
    t,
    rawSpeechDb: m.raw ? m.raw.speechDb : NaN,
    fxSpeechDb: m.fx.speechDb,
    rawPauseDb: m.raw ? m.raw.pauseDb : NaN,
    fxPauseDb: m.fx.pauseDb,
    talking: isHeard(m),
  }
  return trim({ points: [...h.points, p], markers: h.markers }, t, windowMs)
}

/** Adds a change marker at time t (markers older than windowMs drop off with the points). */
export function markHistory(h: LiveHistory, label: Msg, t: number, windowMs = HISTORY_MS): LiveHistory {
  return trim({ points: h.points, markers: [...h.markers, { t, label }] }, t, windowMs)
}
