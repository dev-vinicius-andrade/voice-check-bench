// What the "Listen and save" step shows of a TuneResult (SPEC "Tune from a recording — screen", step 4): before →
// after rows with a direction, and the samples prepared for playback. Framework-free.
import { PEAK_WARN_DB } from '../../audio/diagnose'
import { targetsOf, type TakeSummary, type TuneResult } from '../tune'
import { toneExcess } from '../tune/targets'

/** 'over': the loudest moment ends above the peak ceiling (it still distorts): an error, never a comparison. */
export type Direction = 'better' | 'worse' | 'same' | 'over'

/** A value shown as words instead of a number: digital silence in the pauses, nothing to compare, a band hidden by room noise. */
export type RowNote = 'silence' | 'none' | 'hidden' | 'noBursts'

/** Pauses at or under this are digital silence, dBFS. */
export const SILENCE_DBFS = -95

export type MetricId = 'speech' | 'peak' | 'noise' | 'snr' | 'bursts' | 'spread' | 'band'

export interface MetricRow {
  id: MetricId
  /** BANDS index, for 'band'. */
  band?: number
  before: number
  after: number
  /** dBFS for levels, dB for differences. */
  unit: 'dbfs' | 'db'
  dir: Direction
  /** Words in place of the before / after number. */
  beforeNote?: RowNote
  afterNote?: RowNote
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

const silent = (s: TakeSummary): boolean => s.pauseDb <= SILENCE_DBFS
const note = (n: RowNote, before: boolean, after: boolean): Pick<MetricRow, 'beforeNote' | 'afterNote'> => ({ ...(before ? { beforeNote: n } : {}), ...(after ? { afterNote: n } : {}) })

/** Peaks only matter near clipping: rising into the last dB is worse, coming out of it is better. */
function peakDir(before: number, after: number): Direction {
  if (after > PEAK_WARN_DB && after > before + SAME_DB) return 'worse'
  if (before > PEAK_WARN_DB && after < before - SAME_DB) return 'better'
  return 'same'
}

/**
 * Noise bursts in the pauses (the loudest, dB under the voice: further under is better, none is best); no row when
 * neither side has one or could be measured.
 */
function burstRow(b: TakeSummary, a: TakeSummary): MetricRow[] {
  const has = (s: TakeSummary): boolean => Number.isFinite(s.burstDb)
  if (!has(b) && !has(a)) return []
  const dir: Direction = has(b) && has(a) ? lowerBetter(-b.burstDb, -a.burstDb) : has(a) ? 'worse' : 'better'
  return [{ id: 'bursts', before: has(b) ? b.burstDb : 0, after: has(a) ? a.burstDb : 0, unit: 'db', dir, ...note('noBursts', !has(b), !has(a)) }]
}

/** Voice level, peak, room noise in pauses, voice over room, bursts in the pauses, steadiness, then every tone band
 * that moved ≥ 1 dB (closer to its target, shifted against a complaint, is better). */
export function metricRows(result: Pick<TuneResult, 'before' | 'after' | 'goals' | 'limit'>): MetricRow[] {
  const b: TakeSummary = result.before
  const a: TakeSummary = result.after
  const t = targetsOf(result.goals, result.limit)
  const rows: MetricRow[] = [
    { id: 'speech', before: b.speechDb, after: a.speechDb, unit: 'dbfs', dir: towards(b.speechDb, a.speechDb, t.speechDb) },
    // a peak over the ceiling still distorts, however much lower it is than before
    { id: 'peak', before: b.peakDb, after: a.peakDb, unit: 'dbfs', dir: a.peakDb > t.peakCeilDb + 0.05 ? 'over' : b.peakDb > t.peakCeilDb + 0.05 ? 'better' : peakDir(b.peakDb, a.peakDb) },
    // pauses at digital silence are silence, not a number, and a voice over silence is not compared
    { id: 'noise', before: b.pauseDb, after: a.pauseDb, unit: 'dbfs', dir: silent(b) && silent(a) ? 'same' : lowerBetter(b.pauseDb, a.pauseDb), ...note('silence', silent(b), silent(a)) },
    { id: 'snr', before: b.snrDb, after: a.snrDb, unit: 'db', dir: silent(a) ? (silent(b) ? 'same' : 'better') : lowerBetter(-b.snrDb, -a.snrDb), ...note('none', silent(b), silent(a)) },
    ...burstRow(b, a),
    { id: 'spread', before: b.spreadDb, after: a.spreadDb, unit: 'db', dir: lowerBetter(b.spreadDb, a.spreadDb) },
  ]
  const [eb, ea] = [toneExcess(b.tone, t), toneExcess(a.tone, t)]
  // a summary without a voice (not enough speech) has no tone at all: nothing is hidden there
  const voiced = b.tone.some(Number.isFinite) && a.tone.some(Number.isFinite)
  b.tone.forEach((v, i) => {
    const w = a.tone[i]
    if (!(t.weight[i] > 0)) return
    // a band the room hides (no measurable voice there) says so instead of showing a number
    if (Number.isNaN(v) && Number.isNaN(w) && voiced) return void rows.push({ id: 'band', band: i, before: 0, after: 0, unit: 'db', dir: 'same', beforeNote: 'hidden', afterNote: 'hidden' })
    if (!Number.isFinite(v) || !Number.isFinite(w) || Math.abs(w - v) < BAND_ROW_MIN_DB) return
    // inside its tolerance before and after: nothing to tell
    if (eb[i] === 0 && ea[i] === 0) return
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
