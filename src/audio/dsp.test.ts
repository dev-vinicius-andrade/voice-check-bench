import { describe, expect, it } from 'vitest'
import { adb, db, fft, hann, median, pct, powerSpec } from './dsp'

describe('fft', () => {
  it('puts an exact-bin 1 kHz sine at its bin with amplitude n/2', () => {
    const n = 1024
    const sr = 8192 // 1000 Hz lands exactly on bin 125
    const re = new Float64Array(n)
    const im = new Float64Array(n)
    for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * 1000 * i) / sr)
    fft(re, im)
    const mag = Array.from({ length: n / 2 }, (_, i) => Math.hypot(re[i], im[i]))
    const top = mag.indexOf(Math.max(...mag))
    expect(top).toBe(125)
    expect(mag[125]).toBeCloseTo(n / 2, 6)
    for (let i = 0; i < n / 2; i++) if (i !== 125) expect(mag[i]).toBeLessThan(1e-6)
  })

  it('powerSpec of a 1 kHz sine at 48 kHz peaks at round(1000 * N / sr)', () => {
    const sr = 48000
    const n = 4096
    const x = Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 1000 * i) / sr))
    const p = powerSpec(x, 0, n)
    expect(p.length).toBe(n / 2 + 1)
    const top = Array.from(p).indexOf(Math.max(...p))
    expect(top).toBe(Math.round((1000 * n) / sr))
  })

  it('powerSpec treats samples past the end as zero', () => {
    const p = powerSpec(new Float32Array(10).fill(1), 5, 16)
    expect(p.every(Number.isFinite)).toBe(true)
  })
})

describe('hann', () => {
  it('is symmetric, zero at the ends and cached', () => {
    const w = hann(9)
    expect(w[0]).toBeCloseTo(0, 12)
    expect(w[8]).toBeCloseTo(0, 12)
    expect(w[4]).toBeCloseTo(1, 12)
    expect(w[2]).toBeCloseTo(w[6], 12)
    expect(hann(9)).toBe(w)
  })
})

describe('pct / median / db', () => {
  it('interpolates percentiles linearly', () => {
    expect(pct([4, 1, 3, 2], 0.5)).toBe(2.5)
    expect(pct([10, 20], 0.1)).toBeCloseTo(11, 12)
    expect(pct([5, 1, 9], 0)).toBe(1)
    expect(pct([5, 1, 9], 1)).toBe(9)
    expect(pct(new Float64Array([3, 1, 2]), 0.5)).toBe(2)
    expect(Number.isNaN(pct([], 0.5))).toBe(true)
  })

  it('median of odd and even arrays', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([1, 2, 3, 10])).toBe(2.5)
  })

  it('does not reorder its input', () => {
    const a = [3, 1, 2]
    median(a)
    expect(a).toEqual([3, 1, 2])
  })

  it('db and adb', () => {
    expect(db(1)).toBeCloseTo(0, 9)
    expect(db(100)).toBeCloseTo(20, 9)
    expect(adb(0.1)).toBeCloseTo(-20, 9)
    expect(adb(0)).toBeCloseTo(-240, 9)
  })
})
