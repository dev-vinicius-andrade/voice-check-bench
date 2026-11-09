import { describe, expect, it } from 'vitest'
import { failureHint, quickStats } from './quickStats'

const SR = 48000
function take(silenceAmp: number, readingAmp: number, seconds = 8): Float32Array {
  const x = new Float32Array(SR * seconds)
  for (let i = 0; i < x.length; i++) {
    const amp = i < SR * 3 ? silenceAmp : readingAmp
    x[i] = amp * Math.sin((2 * Math.PI * 220 * i) / SR)
  }
  return x
}

describe('quickStats / failureHint', () => {
  it('flags a silent take', () => {
    expect(failureHint(quickStats(new Float32Array(SR * 6), SR))).toMatch(/silent/)
  })
  it('flags a noisy silence window', () => {
    const q = quickStats(take(0.05, 0.08), SR)
    expect(q.readingDb - q.silenceDb).toBeLessThan(15)
    expect(failureHint(q)).toMatch(/silence/)
  })
  it('flags a very quiet voice', () => {
    expect(failureHint(quickStats(take(0.00001, 0.0005), SR))).toMatch(/barely/)
  })
  it('measures duration and peak', () => {
    const q = quickStats(take(0, 0.5), SR)
    expect(q.duration).toBeCloseTo(8, 5)
    expect(q.peakDb).toBeCloseTo(-6, 0)
  })
})
