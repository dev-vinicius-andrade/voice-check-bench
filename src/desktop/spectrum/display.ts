// The plot's spectrum: a short overlapping FFT mapped onto SPECTRUM_POINTS log-spaced points, smoothed like a plugin
// analyser (fast up, slow down). Pure, framework-free.
import { FLOOR_DB, Framer, powDb } from './framer'
import { SPECTRUM_MAX_HZ, SPECTRUM_MIN_HZ, SPECTRUM_POINTS } from './types'

/** FFT size and hop of the plot's spectrum (85 ms window, 43 ms hop at 48 kHz). */
export const DISPLAY_FFT = 4096
export const DISPLAY_HOP = 2048
/** Smoothing of the plot (in dB, per FFT frame): time to cover 90 % of a step up and of a step down, ms. */
export const ATTACK_MS = 100
export const RELEASE_MS = 600
/** Lowest level a measured point takes, dB (digital silence); FLOOR_DB (−200) stays for "nothing heard yet". */
export const DISPLAY_MIN_DB = -150

/** Centres of the plot points, Hz: SPECTRUM_POINTS log-spaced from SPECTRUM_MIN_HZ to SPECTRUM_MAX_HZ. */
export function spectrumFreqs(): Float32Array {
  const out = new Float32Array(SPECTRUM_POINTS)
  const r = Math.log(SPECTRUM_MAX_HZ / SPECTRUM_MIN_HZ)
  for (let i = 0; i < SPECTRUM_POINTS; i++) out[i] = SPECTRUM_MIN_HZ * Math.exp((r * i) / (SPECTRUM_POINTS - 1))
  return out
}

/**
 * How each plot point reads the FFT bins: the loudest bin between the point's edges (geometric midpoints to its
 * neighbours) when there is one, so a narrow tone stays visible; otherwise (low frequencies, where bins are sparser
 * than points) the two bins around its centre, interpolated in dB. Above Nyquist a point stays at the floor.
 */
interface PointMap {
  lo: Int32Array
  hi: Int32Array
  /** Fractional bin of the centre (used when lo > hi). */
  at: Float64Array
}

function pointMap(freqs: Float32Array, sampleRate: number, size: number): PointMap {
  const n = freqs.length
  const binHz = sampleRate / size
  const half = Math.sqrt(SPECTRUM_MAX_HZ / SPECTRUM_MIN_HZ) ** (1 / (n - 1))
  const maxBin = size / 2
  const lo = new Int32Array(n)
  const hi = new Int32Array(n)
  const at = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    lo[i] = Math.ceil(freqs[i] / half / binHz)
    hi[i] = Math.min(maxBin, Math.floor((freqs[i] * half) / binHz - 1e-9))
    at[i] = freqs[i] / binHz
    if (at[i] > maxBin) {
      lo[i] = 1
      hi[i] = 0
      at[i] = -1
    }
  }
  return { lo, hi, at }
}

/** One signal's plot spectrum. `db` is the smoothed level per point, FLOOR_DB until a frame was heard. */
export class DisplaySpectrum {
  readonly db: Float32Array
  private readonly framer: Framer
  private readonly map: PointMap
  private readonly up: number
  private readonly down: number

  constructor(freqs: Float32Array, sampleRate: number) {
    this.db = new Float32Array(freqs.length).fill(FLOOR_DB)
    this.map = pointMap(freqs, sampleRate, DISPLAY_FFT)
    const dtMs = (1000 * DISPLAY_HOP) / sampleRate
    this.up = 1 - Math.exp((-dtMs * Math.LN10) / ATTACK_MS)
    this.down = 1 - Math.exp((-dtMs * Math.LN10) / RELEASE_MS)
    this.framer = new Framer(DISPLAY_FFT, DISPLAY_HOP, (p) => this.update(p))
  }

  push(x: ArrayLike<number>, n: number): void {
    this.framer.push(x, n)
  }

  reset(): void {
    this.framer.reset()
    this.db.fill(FLOOR_DB)
  }

  private update(p: Float64Array): void {
    const { lo, hi, at } = this.map
    const db = this.db
    for (let i = 0; i < db.length; i++) {
      let v: number
      if (at[i] < 0) v = FLOOR_DB
      else if (lo[i] <= hi[i]) {
        let m = 0
        for (let k = lo[i]; k <= hi[i]; k++) if (p[k] > m) m = p[k]
        v = powDb(m)
      } else {
        const k0 = Math.floor(at[i])
        const t = at[i] - k0
        const k1 = Math.min(p.length - 1, k0 + 1)
        v = powDb(p[k0]) * (1 - t) + powDb(p[k1]) * t
      }
      if (v < DISPLAY_MIN_DB) v = DISPLAY_MIN_DB
      const cur = db[i]
      db[i] = cur <= FLOOR_DB ? v : cur + (v - cur) * (v > cur ? this.up : this.down)
    }
  }
}
