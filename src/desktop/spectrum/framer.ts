// Overlapping FFT frames of a sample stream, as power per bin in dBFS units (a full-scale sine on a bin reads 1, i.e.
// 0 dB). Reuses the repo's radix-2 FFT and Hann window (src/audio/dsp.ts). Pure, framework-free.
import { fft, hann } from '../../audio/dsp'

/**
 * Collects samples in a ring of `size` and calls `onFrame` with the Hann-windowed power spectrum (bins 0..size/2) of the
 * latest `size` samples every `hop` samples, once the ring is full. The power array is reused between calls.
 */
export class Framer {
  private readonly ring: Float32Array
  private readonly win: Float64Array
  private readonly re: Float64Array
  private readonly im: Float64Array
  private readonly power: Float64Array
  /** 1 / (Σw / 2)²: a full-scale sine centred on a bin reads power 1. */
  private readonly norm: number
  private pos = 0
  private filled = 0
  private sinceHop = 0

  constructor(
    readonly size: number,
    readonly hop: number,
    private readonly onFrame: (power: Float64Array) => void,
  ) {
    this.ring = new Float32Array(size)
    this.win = hann(size)
    this.re = new Float64Array(size)
    this.im = new Float64Array(size)
    this.power = new Float64Array(size / 2 + 1)
    let s = 0
    for (let i = 0; i < size; i++) s += this.win[i]
    this.norm = 1 / ((s / 2) * (s / 2))
  }

  push(x: ArrayLike<number>, n = x.length): void {
    const { ring, size } = this
    for (let i = 0; i < n; i++) {
      const v = x[i]
      ring[this.pos] = Number.isFinite(v) ? v : 0
      this.pos = this.pos + 1 === size ? 0 : this.pos + 1
      if (this.filled < size) this.filled++
      this.sinceHop++
      if (this.filled === size && this.sinceHop >= this.hop) {
        this.sinceHop = 0
        this.emit()
      }
    }
  }

  reset(): void {
    this.ring.fill(0)
    this.pos = 0
    this.filled = 0
    this.sinceHop = 0
  }

  private emit(): void {
    const { ring, win, re, im, power, size, norm } = this
    for (let k = 0, j = this.pos; k < size; k++) {
      re[k] = ring[j] * win[k]
      im[k] = 0
      j = j + 1 === size ? 0 : j + 1
    }
    fft(re, im)
    for (let k = 0; k <= size / 2; k++) power[k] = (re[k] * re[k] + im[k] * im[k]) * norm
    this.onFrame(power)
  }
}

/** The plot's floor, dB: "nothing heard". */
export const FLOOR_DB = -200

/** Power → dB, never below FLOOR_DB. */
export const powDb = (p: number): number => (p > 1e-20 ? 10 * Math.log10(p) : FLOOR_DB)

/** Median of a[lo..hi] (inclusive, clamped to the array), via `scratch` (length ≥ hi - lo + 1). Lower median for even counts. */
export function medianOf(a: ArrayLike<number>, lo: number, hi: number, scratch: Float64Array): number {
  const from = Math.max(0, lo)
  const to = Math.min(a.length - 1, hi)
  const n = to - from + 1
  if (n <= 0) return NaN
  for (let i = 0; i < n; i++) scratch[i] = a[from + i]
  return select(scratch, n, (n - 1) >> 1)
}

/** k-th smallest of s[0..n) (Hoare quickselect, in place). */
function select(s: Float64Array, n: number, k: number): number {
  let l = 0
  let r = n - 1
  while (l < r) {
    const pivot = s[(l + r) >> 1]
    let i = l
    let j = r
    while (i <= j) {
      while (s[i] < pivot) i++
      while (s[j] > pivot) j--
      if (i <= j) {
        const t = s[i]
        s[i] = s[j]
        s[j] = t
        i++
        j--
      }
    }
    if (k <= j) r = j
    else if (k >= i) l = i
    else return s[k]
  }
  return s[k]
}
