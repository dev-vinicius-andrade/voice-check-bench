// What the "Listen and save" step shows of a TuneResult (SPEC "Tune from a recording — screen", step 4): before →
// after rows with a direction, and the samples prepared for playback. Framework-free.
import { PEAK_WARN_DB } from '../../audio/diagnose'
import { targetsOf, type TakeSummary, type TuneResult } from '../tune'

export type Direction = 'better' | 'worse' | 'same'

export type MetricId = 'speech' | 'peak' | 'noise' | 'snr' | 'spread' | 'band'

export interface MetricRow {
  id: MetricId
  /** BANDS index, for 'band'. */
  band?: number
  before: number
  after: number
  /** dBFS for levels, dB for differences. */
  unit: 'dbfs' | 'db'
  dir: Direction
}

/** A tone band is listed when it moved at least this much. */
export const BAND_ROW_MIN_DB = 1
/** Smaller moves count as "same". */
const SAME_DB = 0.5

const lowerBetter = (before: number, after: number): Direction =>
  after < before - SAME_DB ? 'better' : after > before + SAME_DB ? 'worse' : 'same'

/** Closer to `target` is better. */
const towards = (before: number, after: number, target: number): Direction =>
  lowerBetter(Math.abs(before - target), Math.abs(after - target))

/** Peaks only matter near clipping: rising into the last dB is worse, coming out of it is better. */
function peakDir(before: number, after: number): Direction {
  if (after > PEAK_WARN_DB && after > before + SAME_DB) return 'worse'
  if (before > PEAK_WARN_DB && after < before - SAME_DB) return 'better'
  return 'same'
}

/** Voice level, peak, room noise in pauses, voice over room, steadiness, then every tone band that moved ≥ 1 dB
 * (closer to its target, shifted against a complaint, is better). */
export function metricRows(result: Pick<TuneResult, 'before' | 'after' | 'goals' | 'limit'>): MetricRow[] {
  const b: TakeSummary = result.before
  const a: TakeSummary = result.after
  const t = targetsOf(result.goals, result.limit)
  const rows: MetricRow[] = [
    { id: 'speech', before: b.speechDb, after: a.speechDb, unit: 'dbfs', dir: towards(b.speechDb, a.speechDb, t.speechDb) },
    { id: 'peak', before: b.peakDb, after: a.peakDb, unit: 'dbfs', dir: peakDir(b.peakDb, a.peakDb) },
    { id: 'noise', before: b.pauseDb, after: a.pauseDb, unit: 'dbfs', dir: lowerBetter(b.pauseDb, a.pauseDb) },
    { id: 'snr', before: b.snrDb, after: a.snrDb, unit: 'db', dir: lowerBetter(-b.snrDb, -a.snrDb) },
    { id: 'spread', before: b.spreadDb, after: a.spreadDb, unit: 'db', dir: lowerBetter(b.spreadDb, a.spreadDb) },
  ]
  b.tone.forEach((v, i) => {
    const w = a.tone[i]
    if (!Number.isFinite(v) || !Number.isFinite(w) || Math.abs(w - v) < BAND_ROW_MIN_DB) return
    rows.push({ id: 'band', band: i, before: v, after: w, unit: 'db', dir: towards(v, w, t.shift[i] ?? 0) })
  })
  return rows.filter((r) => Number.isFinite(r.before) && Number.isFinite(r.after))
}

/** A copy clamped to ±1: renders are not clamped, playback must be. */
export function forPlayback(x: Float32Array): Float32Array<ArrayBuffer> {
  const out = new Float32Array(x.length)
  for (let i = 0; i < x.length; i++) out[i] = Math.max(-1, Math.min(1, x[i]))
  return out
}
