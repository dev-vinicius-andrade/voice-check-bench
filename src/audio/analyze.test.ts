// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { isAnalysisError, type Analysis } from '../types'
import { analyze } from './analyze'
import { BANDS } from './reference'
import { syntheticTake } from './testSignals'

const ERROR = 'Not enough speech detected. Speak louder or closer, or check the selected input.'

describe('analyze on a synthetic take', () => {
  const x = syntheticTake()
  const r = analyze(x, 48000)

  it('returns an analysis, not an error', () => {
    expect(isAnalysisError(r)).toBe(false)
  })

  const a = r as Analysis

  it('maps sampleRate and duration', () => {
    expect(a.sampleRate).toBe(48000)
    expect(a.duration).toBeCloseTo(15, 9)
  })

  it('measures noise from the silence window', () => {
    expect(a.noiseFromQuiet).toBe(true)
    expect(a.quietBroken).toBe(false)
    expect(Math.abs(a.noise - -80)).toBeLessThanOrEqual(3)
  })

  it('measures speech level and SNR', () => {
    expect(a.speechMed).toBeGreaterThan(-35)
    expect(a.speechMed).toBeLessThan(-15)
    expect(a.speechP90).toBeGreaterThanOrEqual(a.speechMed)
    expect(a.speechMax).toBeGreaterThanOrEqual(a.speechP90)
    expect(a.snr).toBeGreaterThan(40)
    expect(a.snr).toBeCloseTo(a.speechMed - a.noise, 9)
    expect(a.clip).toBe(0)
    expect(a.peak).toBeLessThan(0)
  })

  it('returns one band per BANDS entry, relative to the body band', () => {
    expect(a.rel).toHaveLength(9)
    expect(a.rel).toHaveLength(BANDS.length)
    expect(a.rel[4]).toBe(0)
    expect(a.rel.every(Number.isFinite)).toBe(true)
  })

  it('computes hum, sibilance and spread', () => {
    expect(a.hum.map((h) => h.hz)).toEqual([50, 60, 100, 120, 150, 180])
    expect(a.hum.every((h) => Number.isFinite(h.db))).toBe(true)
    expect(Number.isFinite(a.sibMed)).toBe(true)
    expect(a.sibP95).toBeGreaterThanOrEqual(a.sibMed)
    expect(a.spread).toBeGreaterThanOrEqual(0)
  })

  it('is deterministic', () => {
    expect(analyze(syntheticTake(), 48000)).toEqual(r)
  })
})

describe('analyze edge cases', () => {
  it('flags sound in the silence window', () => {
    const x = syntheticTake()
    for (let i = Math.round(1.0 * 48000); i < Math.round(1.6 * 48000); i++) x[i] += 0.3 * Math.sin(i / 7)
    const a = analyze(x, 48000)
    expect(isAnalysisError(a)).toBe(false)
    expect((a as Analysis).quietBroken).toBe(true)
  })

  it('uses the quietest 10% of the take when the silence window is loud', () => {
    const sr = 48000
    const x = syntheticTake()
    const quiet = syntheticTake({ speechSec: 12, speechDb: -300, seed: 99 })
    // loud noise over the whole silence window, and a 6 s pause at the end of the speech
    for (let i = Math.round(0.6 * sr); i < Math.round(2.7 * sr); i++) x[i] = quiet[i] * 400
    for (let i = 9 * sr; i < 15 * sr; i++) x[i] = quiet[i]
    const a = analyze(x, sr)
    expect(isAnalysisError(a)).toBe(false)
    const ok = a as Analysis
    expect(ok.noiseFromQuiet).toBe(true)
    expect(ok.quietBroken).toBe(true)
    expect(Math.abs(ok.noise - -80)).toBeLessThanOrEqual(3)
  })

  it('returns the exact error for silence', () => {
    expect(analyze(new Float32Array(48000 * 15), 48000)).toEqual({ error: ERROR })
  })

  it('returns the exact error for a too-short take', () => {
    expect(analyze(syntheticTake({ quietSec: 0.5, speechSec: 0 }), 48000)).toEqual({ error: ERROR })
    expect(analyze(new Float32Array(0), 48000)).toEqual({ error: ERROR })
  })
})

describe('analyze on a noisy input', () => {
  it('still analyzes when the room is only ~13 dB below the voice (falls back to a smaller speech margin)', () => {
    const sr = 48000
    const x = new Float32Array(sr * 12)
    let seed = 7
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1
    for (let i = 0; i < x.length; i++) {
      const noise = rnd() * 0.024 // ≈ -37 dBFS RMS room
      const t = i / sr
      const voice = t < 3 ? 0 : 0.12 * Math.max(0, Math.sin(2 * Math.PI * 4 * t)) * Math.sin(2 * Math.PI * 220 * t)
      x[i] = noise + voice
    }
    const a = analyze(x, sr)
    expect('error' in a).toBe(false)
    if (!('error' in a)) {
      expect(a.noise).toBeGreaterThan(-45)
      expect(a.snr).toBeLessThan(20)
    }
  })
})
