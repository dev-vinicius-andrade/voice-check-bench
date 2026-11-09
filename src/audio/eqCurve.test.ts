import { describe, expect, it } from 'vitest'
import { eqResponseDb, logFreqs, type EqCurveBand } from './eqCurve'

const at = (bands: EqCurveBand[], f: number): number => eqResponseDb(bands, [f])[0]

/** First frequency (stepping from f by 0.1 % in `dir`) where the response is at or above `level` dB. */
function crossing(bands: EqCurveBand[], f: number, dir: 1 | -1, level: number): number {
  for (let k = 1; k < 2000; k++) {
    const x = f * Math.pow(1.001, dir * k)
    if (at(bands, x) >= level) return x
  }
  return NaN
}

describe('logFreqs', () => {
  it('spans lo..hi on a log scale', () => {
    const f = logFreqs(4, 20, 20000)
    expect(f).toHaveLength(4)
    expect(f[0]).toBeCloseTo(20, 6)
    expect(f[1]).toBeCloseTo(200, 6)
    expect(f[2]).toBeCloseTo(2000, 6)
    expect(f[3]).toBeCloseTo(20000, 6)
  })
})

describe('eqResponseDb', () => {
  it('is flat with no bands', () => {
    expect(eqResponseDb([], logFreqs(50)).every((v) => v === 0)).toBe(true)
  })

  it('peaks at about +3 dB at the frequency of a +3 dB band', () => {
    const band: EqCurveBand = { type: 'Band', freq: 1000, gain: 3, bw: 1 }
    expect(at([band], 1000)).toBeCloseTo(3, 1)
    const curve = eqResponseDb([band], logFreqs(400))
    expect(Math.max(...curve)).toBeLessThanOrEqual(3.01)
    expect(at([band], 100)).toBeCloseTo(0, 1)
  })

  it('shelves reach their gain far from the corner and stay flat on the other side', () => {
    const low: EqCurveBand = { type: 'Low Shelf', freq: 150, gain: -6, bw: 2 }
    expect(at([low], 20)).toBeCloseTo(-6, 0)
    expect(Math.abs(at([low], 5000))).toBeLessThan(0.1)
    const high: EqCurveBand = { type: 'High Shelf', freq: 10000, gain: 4, bw: 2 }
    expect(at([high], 20000)).toBeGreaterThan(3)
    expect(Math.abs(at([high], 200))).toBeLessThan(0.1)
  })

  it('sums bands in dB', () => {
    const a: EqCurveBand = { type: 'Band', freq: 1000, gain: 3, bw: 1 }
    const b: EqCurveBand = { type: 'Low Shelf', freq: 150, gain: -6, bw: 2 }
    expect(at([a, b], 400)).toBeCloseTo(at([a], 400) + at([b], 400), 9)
  })

  it('a -10 dB 0.1 oct notch is narrow', () => {
    const f = 780
    const notch: EqCurveBand = { type: 'Band', freq: f, gain: -10, bw: 0.1 }
    expect(at([notch], f)).toBeCloseTo(-10, 1)
    // RBJ bandwidth is measured between the half-gain (-5 dB) points: 0.1 oct = ±3.5 %.
    expect(crossing([notch], f, 1, -5) / f).toBeLessThan(1.05)
    expect(f / crossing([notch], f, -1, -5)).toBeLessThan(1.05)
    // The -3 dB points sit just past ±5 % (about ±5.5 %); an octave away the band has no effect.
    expect(crossing([notch], f, 1, -3) / f).toBeLessThan(1.06)
    expect(f / crossing([notch], f, -1, -3)).toBeLessThan(1.06)
    expect(Math.abs(at([notch], f * 2))).toBeLessThan(0.2)
  })
})
