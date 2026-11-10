// Pure mapping from live numbers to words, colors and positions (thresholds from src/audio/diagnose.ts).
import { LEVEL_GOOD_MAX, LEVEL_GOOD_MIN, PEAK_WARN_DB } from '../../audio/diagnose'
import type { LiveSide } from '../../live/types'

export type LevelWord = 'quiet' | 'good' | 'loud' | 'none'
export type ThemeStatus = 'success' | 'warning' | 'error'

/** Meter range, dBFS. */
export const METER_MIN = -60
export const METER_MAX = 0
/** Tone rows clamp deviations to ±TONE_RANGE dB. */
export const TONE_RANGE = 12

export function levelWord(side: Pick<LiveSide, 'speechDb' | 'peakDb'>): LevelWord {
  if (!Number.isFinite(side.speechDb)) return 'none'
  if (side.speechDb > LEVEL_GOOD_MAX || side.peakDb >= PEAK_WARN_DB) return 'loud'
  if (side.speechDb < LEVEL_GOOD_MIN) return 'quiet'
  return 'good'
}

export const levelColor = (w: LevelWord): ThemeStatus | null =>
  w === 'good' ? 'success' : w === 'quiet' ? 'warning' : w === 'loud' ? 'error' : null

/** 0..100 % along the meter. */
export const meterPct = (db: number): number => {
  const c = Math.min(METER_MAX, Math.max(METER_MIN, db))
  return ((c - METER_MIN) / (METER_MAX - METER_MIN)) * 100
}

/** 0..100 % along a tone row, 50 = on the goal. */
export const tonePct = (dev: number): number => 50 + (Math.min(TONE_RANGE, Math.max(-TONE_RANGE, dev)) / TONE_RANGE) * 50

/** success under 3 dB off the goal, warning from 3, error from 6. */
export const toneColor = (dev: number): ThemeStatus => {
  const a = Math.abs(dev)
  return a >= 6 ? 'error' : a >= 3 ? 'warning' : 'success'
}
