// Magnitude response of ReaEQ-style bands (RBJ Audio EQ Cookbook biquads) for drawing the EQ curve in the guide.
// Pure math, no React. Bandwidth is in octaves for every band type, like ReaEQ.
import type { EqBand } from '../types'

export const EQ_SAMPLE_RATE = 48000

export type EqCurveBand = Pick<EqBand, 'type' | 'freq' | 'gain' | 'bw'>

interface Biquad {
  b0: number
  b1: number
  b2: number
  a0: number
  a1: number
  a2: number
}

/** RBJ coefficients for one band; bandwidth (oct) → alpha via the cookbook's BW form. */
export function biquad(band: EqCurveBand, fs = EQ_SAMPLE_RATE): Biquad {
  const nyq = fs / 2
  const f0 = Math.min(Math.max(band.freq, 1), nyq * 0.999)
  const w0 = (2 * Math.PI * f0) / fs
  const cos = Math.cos(w0)
  const sin = Math.sin(w0)
  const bw = Math.max(band.bw, 0.001)
  const alpha = sin * Math.sinh((Math.LN2 / 2) * bw * (w0 / sin))
  const A = Math.pow(10, band.gain / 40)
  const sq = 2 * Math.sqrt(A) * alpha
  switch (band.type) {
    case 'Low Shelf':
      return {
        b0: A * (A + 1 - (A - 1) * cos + sq),
        b1: 2 * A * (A - 1 - (A + 1) * cos),
        b2: A * (A + 1 - (A - 1) * cos - sq),
        a0: A + 1 + (A - 1) * cos + sq,
        a1: -2 * (A - 1 + (A + 1) * cos),
        a2: A + 1 + (A - 1) * cos - sq,
      }
    case 'High Shelf':
      return {
        b0: A * (A + 1 + (A - 1) * cos + sq),
        b1: -2 * A * (A - 1 + (A + 1) * cos),
        b2: A * (A + 1 + (A - 1) * cos - sq),
        a0: A + 1 - (A - 1) * cos + sq,
        a1: 2 * (A - 1 - (A + 1) * cos),
        a2: A + 1 - (A - 1) * cos - sq,
      }
    default:
      return { b0: 1 + alpha * A, b1: -2 * cos, b2: 1 - alpha * A, a0: 1 + alpha / A, a1: -2 * cos, a2: 1 - alpha / A }
  }
}

/** |H(e^jw)| in dB of one biquad at frequency f. */
function biquadDb(c: Biquad, f: number, fs: number): number {
  const w = (2 * Math.PI * f) / fs
  const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w)
  const nr = c.b0 + c.b1 * c1 + c.b2 * c2
  const ni = c.b1 * s1 + c.b2 * s2
  const dr = c.a0 + c.a1 * c1 + c.a2 * c2
  const di = c.a1 * s1 + c.a2 * s2
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di))
}

/** Summed response (dB) of all bands at each frequency; 0 dB everywhere when there are no bands. */
export function eqResponseDb(bands: readonly EqCurveBand[], freqs: readonly number[], fs = EQ_SAMPLE_RATE): number[] {
  const coeffs = bands.map((b) => biquad(b, fs))
  return freqs.map((f) => coeffs.reduce((sum, c) => sum + biquadDb(c, f, fs), 0))
}

/** n log-spaced frequencies from lo to hi (inclusive). */
export function logFreqs(n: number, lo = 20, hi = 20000): number[] {
  if (n <= 1) return [lo]
  const r = Math.log(hi / lo)
  return Array.from({ length: n }, (_, i) => lo * Math.exp((r * i) / (n - 1)))
}
