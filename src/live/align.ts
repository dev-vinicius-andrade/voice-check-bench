// Delay of the Wave Link output behind the raw mic (SPEC "Live tuning (v1.3)"). Pure.
// Both inputs are cut into 10 ms RMS envelopes in dB (floored, clamped ENV_RANGE_DB below their loudest frame, mean
// removed per lag) and compared by normalized cross-correlation (Pearson) over 0..LIVE_MAX_LAG_MS, with a small
// tolerance for fx being slightly ahead. The best lag is refined with a parabola through its neighbours.
import { adb, median } from '../audio/dsp'
import { FLOOR_DB } from '../audio/analyze'
import { LIVE_MAX_LAG_MS } from './types'

/** Envelope frame length, seconds. */
export const ENV_FRAME_SEC = 0.01
/** Envelope levels are clamped this many dB below the envelope's loudest frame (pauses compare as "low", whatever the gate did). */
export const ENV_RANGE_DB = 40
/** fx may read up to this many ms ahead of raw (clock jitter between the two devices). */
export const ALIGN_NEG_TOL_MS = 20
/** An estimate whose correlation peak reaches this counts for the smoothed lag. */
export const SYNC_CONFIDENT = 0.5
/** The smoothed lag is the median of this many latest confident estimates. */
export const LAG_HISTORY = 5
/** A lag needs at least this many overlapping envelope frames (0.5 s) to be scored. */
const MIN_OVERLAP = 50

export interface LagEstimate {
  /** Delay of fx behind raw, ms (negative: fx ahead, at most ALIGN_NEG_TOL_MS). */
  lagMs: number
  /** Correlation peak, 0..1. */
  sync: number
}

/** 10 ms RMS envelope in dB, floored at FLOOR_DB and clamped ENV_RANGE_DB below its maximum. */
export function envelopeDb(x: Float32Array, sampleRate: number, frameSec = ENV_FRAME_SEC): Float64Array {
  const w = Math.max(1, Math.round(frameSec * sampleRate))
  const n = Math.floor(x.length / w)
  const env = new Float64Array(n)
  let max = FLOOR_DB
  for (let f = 0; f < n; f++) {
    let s = 0
    for (let i = f * w; i < (f + 1) * w; i++) s += x[i] * x[i]
    const v = Math.max(FLOOR_DB, adb(Math.sqrt(s / w)))
    env[f] = v
    if (v > max) max = v
  }
  const lo = Math.max(FLOOR_DB, max - ENV_RANGE_DB)
  for (let f = 0; f < n; f++) if (env[f] < lo) env[f] = lo
  return env
}

/** Pearson correlation of a[i] with b[i + lag] over their overlap; NaN when too short or either side is flat. */
function corrAt(a: Float64Array, b: Float64Array, lag: number): number {
  const i0 = Math.max(0, -lag)
  const i1 = Math.min(a.length, b.length - lag)
  const n = i1 - i0
  if (n < MIN_OVERLAP) return NaN
  let sa = 0
  let sb = 0
  for (let i = i0; i < i1; i++) {
    sa += a[i]
    sb += b[i + lag]
  }
  const ma = sa / n
  const mb = sb / n
  let cov = 0
  let va = 0
  let vb = 0
  for (let i = i0; i < i1; i++) {
    const da = a[i] - ma
    const db = b[i + lag] - mb
    cov += da * db
    va += da * da
    vb += db * db
  }
  if (va < 1e-9 || vb < 1e-9) return NaN
  return cov / Math.sqrt(va * vb)
}

/**
 * Delay of fx behind raw from two windows that end at the same instant (same AudioContext frame).
 * sync is the correlation peak clamped to 0..1 (0 when nothing could be compared, e.g. digital silence).
 */
export function estimateLag(raw: Float32Array, fx: Float32Array, sampleRate: number, maxLagMs = LIVE_MAX_LAG_MS): LagEstimate {
  // envelopes aligned at the end: drop the oldest samples of the longer window
  const len = Math.min(raw.length, fx.length)
  const a = envelopeDb(raw.subarray(raw.length - len), sampleRate)
  const b = envelopeDb(fx.subarray(fx.length - len), sampleRate)
  const frameMs = ENV_FRAME_SEC * 1000
  const lo = -Math.round(ALIGN_NEG_TOL_MS / frameMs)
  const hi = Math.round(maxLagMs / frameMs)
  const c: number[] = []
  let best = -1
  for (let lag = lo; lag <= hi; lag++) {
    const v = corrAt(a, b, lag)
    c.push(v)
    if (Number.isFinite(v) && (best < 0 || v > c[best])) best = c.length - 1
  }
  if (best < 0) return { lagMs: 0, sync: 0 }
  const peak = c[best]
  let frac = 0
  const l = c[best - 1]
  const r = c[best + 1]
  if (Number.isFinite(l) && Number.isFinite(r)) {
    const den = l - 2 * peak + r
    if (den < 0) frac = Math.max(-0.5, Math.min(0.5, (0.5 * (l - r)) / den))
  }
  return { lagMs: (lo + best + frac) * frameMs, sync: Math.max(0, Math.min(1, peak)) }
}

/** Smoothed lag: median of the last LAG_HISTORY confident estimates (sync ≥ SYNC_CONFIDENT); null before the first. */
export class LagTracker {
  private history: number[] = []

  /** Adds an estimate (ignored unless confident) and returns the smoothed lag. */
  push(e: LagEstimate): number | null {
    if (e.sync >= SYNC_CONFIDENT && Number.isFinite(e.lagMs)) {
      this.history.push(e.lagMs)
      if (this.history.length > LAG_HISTORY) this.history.shift()
    }
    return this.lagMs
  }

  get lagMs(): number | null {
    return this.history.length ? median(this.history) : null
  }

  reset(): void {
    this.history = []
  }
}
