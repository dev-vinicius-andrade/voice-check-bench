// Processed take vs the raw control of the same session (SPEC "Over-processing safety (v0.8)"). Pure.
import { LEVEL_GOOD_MAX, overprocessedStatus, PEAK_WARN_DB } from '../audio/diagnose'
import { deviations } from '../audio/reference'
import type { Analysis, Status } from '../types'

export type Regression = 'tooLoud' | 'quieter' | 'thin' | 'harsh' | 'chopped'

export interface ProcessedComparison {
  /** What the effects made worse, in this order: tooLoud or quieter (never both), thin, harsh, chopped. */
  regressions: Regression[]
  /** Speech level lost to the effects, dB (raw speech median − processed); negative when the effects made it louder. */
  levelDrop: number
}

/** Level drop above this many dB: "your voice got much quieter". */
export const QUIETER_DB = 8
/** Bass loss (mean boom + warmth deviation drop) above this many dB: "thin". */
export const THIN_DB = 12
/** Presence or sibilance deviation rise above this many dB: "harsh". */
export const HARSH_DB = 6

/**
 * Too loud after the effects: the peak reaches PEAK_WARN_DB (clipping, so the limiter distorts) or the speech level is
 * above the level check's good range. Takes the place of "quieter".
 */
export const isTooLoud = (fx: Pick<Analysis, 'peak' | 'speechMed'>): boolean =>
  fx.peak >= PEAK_WARN_DB || fx.speechMed > LEVEL_GOOD_MAX

const RANK: Record<Status, number> = { good: 0, warn: 1, bad: 2 }
const finite = (v: number): boolean => Number.isFinite(v)

export function compareProcessed(raw: Analysis, fx: Analysis): ProcessedComparison {
  const regressions: Regression[] = []
  const levelDrop = raw.speechMed - fx.speechMed
  if (isTooLoud(fx)) regressions.push('tooLoud')
  else if (finite(levelDrop) && levelDrop > QUIETER_DB) regressions.push('quieter')

  const dr = deviations(raw.rel)
  const df = deviations(fx.rel)
  const bassDrop = (dr[1] + dr[2]) / 2 - (df[1] + df[2]) / 2
  if (finite(bassDrop) && bassDrop > THIN_DB) regressions.push('thin')
  const rise = Math.max(...[6, 7].map((i) => df[i] - dr[i]).filter(finite))
  if (finite(rise) && rise > HARSH_DB) regressions.push('harsh')

  const over = overprocessedStatus(fx)
  if (over !== 'good' && RANK[over] > RANK[overprocessedStatus(raw)]) regressions.push('chopped')

  return { regressions, levelDrop: finite(levelDrop) ? levelDrop : 0 }
}
