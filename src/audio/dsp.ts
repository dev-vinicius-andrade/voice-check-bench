// DSP helpers ported 1:1 from the prototype (docs/prototype/voice-check.html). Pure.

/** In-place radix-2 FFT. `re.length` must be a power of two; `im` the same length. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let b = n >> 1
    for (; j & b; b >>= 1) j ^= b
    j ^= b
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr
      const ti = im[i]; im[i] = im[j]; im[j] = ti
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len
    const wr = Math.cos(a)
    const wi = Math.sin(a)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const p = i + k
        const q = p + len / 2
        const tr = re[q] * cr - im[q] * ci
        const ti = re[q] * ci + im[q] * cr
        re[q] = re[p] - tr
        im[q] = im[p] - ti
        re[p] += tr
        im[p] += ti
        const t = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = t
      }
    }
  }
}

const hannCache = new Map<number, Float64Array>()

/** Symmetric Hann window of length n (denominator n - 1), cached per length. */
export function hann(n: number): Float64Array {
  let w = hannCache.get(n)
  if (!w) {
    w = Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)))
    hannCache.set(n, w)
  }
  return w
}

/** Hann-windowed power spectrum of x[start .. start+n) (out-of-range samples count as 0). Returns n/2+1 bins. */
export function powerSpec(x: ArrayLike<number>, start: number, n: number): Float64Array {
  const w = hann(n)
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  for (let i = 0; i < n; i++) re[i] = (x[start + i] || 0) * w[i]
  fft(re, im)
  const p = new Float64Array(n / 2 + 1)
  for (let i = 0; i <= n / 2; i++) p[i] = re[i] * re[i] + im[i] * im[i]
  return p
}

/** Power to dB. */
export const db = (v: number): number => 10 * Math.log10(v + 1e-20)
/** Amplitude to dB. */
export const adb = (v: number): number => 20 * Math.log10(v + 1e-12)

/** Linear-interpolated percentile (q in 0..1). NaN for an empty input. */
export function pct(a: ArrayLike<number>, q: number): number {
  if (!a.length) return NaN
  const s = Array.from(a).sort((x, y) => x - y)
  const i = (s.length - 1) * q
  const lo = Math.floor(i)
  const hi = Math.ceil(i)
  return s[lo] + (s[hi] - s[lo]) * (i - lo)
}

export const median = (a: ArrayLike<number>): number => pct(a, 0.5)
