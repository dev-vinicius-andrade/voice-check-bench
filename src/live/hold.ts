// Hold for live tuning (SPEC "Live tuning (v1.3)"): when you stop talking, the speech numbers stay on screen instead of
// going blank. Pure reducer, framework-free; the web live mode and the desktop app feed it the same way.
// Per side, the speech values (speechDb, peakDb, clipFrames, tone) are the last ones measured over a window with at
// least MIN_TALK_SEC of talk, with the time they were measured. Pause noise and dead silence keep updating live (the
// last measured pause level stays while a window has no pause long enough to measure it).
import { MIN_TALK_SEC } from './frames'
import type { LiveMetrics, LiveSide } from './types'

export interface HeldSide extends LiveSide {
  /** When the speech values were measured (the caller's clock, ms); null when no window had enough talk yet. */
  heardAtMs: number | null
  /** How long ago they were measured, ms: 0 for the newest window, > 0 while held; null when never heard. */
  heardAgoMs: number | null
}

/** LiveMetrics with held speech values per side. talkSec, lagMs and sync are those of the newest window; hints are those of the last window with talk. */
export interface HeldMetrics extends Omit<LiveMetrics, 'raw' | 'fx'> {
  raw: HeldSide | null
  fx: HeldSide
}

/** True when the newest window had enough talk to measure speech. */
export const isHeard = (m: Pick<LiveMetrics, 'talkSec'>): boolean => m.talkSec >= MIN_TALK_SEC

function holdSide(prev: HeldSide | null, cur: LiveSide, heard: boolean, nowMs: number): HeldSide {
  const pauseDb = Number.isFinite(cur.pauseDb) || !prev ? cur.pauseDb : prev.pauseDb
  if (heard) return { ...cur, pauseDb, heardAtMs: nowMs, heardAgoMs: 0 }
  if (!prev || prev.heardAtMs === null) return { ...cur, pauseDb, heardAtMs: null, heardAgoMs: null }
  return {
    ...cur,
    speechDb: prev.speechDb,
    peakDb: prev.peakDb,
    clipFrames: prev.clipFrames,
    tone: prev.tone,
    pauseDb,
    heardAtMs: prev.heardAtMs,
    heardAgoMs: Math.max(0, nowMs - prev.heardAtMs),
  }
}

/** Next held metrics. prev null = nothing held (session start). nowMs: any monotonic clock, in ms. */
export function holdMetrics(prev: HeldMetrics | null, m: LiveMetrics, nowMs: number): HeldMetrics {
  const heard = isHeard(m)
  // the advice of the last window with talk stays too, instead of falling back to "keep talking" in every pause
  const hints = !heard && prev && prev.fx.heardAtMs !== null ? prev.hints : m.hints
  return {
    ...m,
    hints,
    raw: m.raw ? holdSide(prev?.raw ?? null, m.raw, heard, nowMs) : null,
    fx: holdSide(prev?.fx ?? null, m.fx, heard, nowMs),
  }
}

/** True when the side's speech values come from an earlier window. */
export const isHeld = (s: Pick<HeldSide, 'heardAgoMs'>): boolean => s.heardAgoMs !== null && s.heardAgoMs > 0
