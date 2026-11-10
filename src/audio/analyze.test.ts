// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { isAnalysisError, type Analysis } from '../types'
import { BAND_SNR_CAP, FLOOR_DB, analyze, bandFloorDb, digitalSilence } from './analyze'
import { diagnose } from './diagnose'
import { BANDS } from './reference'
import { prng, syntheticTake } from './testSignals'

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

describe('analyze noisy-room diagnosis', () => {
  const near = (hz: number, target: number, tol: number) => Math.abs(hz - target) <= target * tol

  it('a quiet synthetic take: per-band levels, quiet kind', () => {
    const a = analyze(syntheticTake(), 48000) as Analysis
    expect(a.speechBands).toHaveLength(9)
    expect(a.noiseBands).toHaveLength(9)
    expect(a.bandSnr).toHaveLength(9)
    expect([...a.speechBands, ...a.noiseBands, ...a.bandSnr].every(Number.isFinite)).toBe(true)
    a.bandSnr.forEach((v, i) => expect(v).toBeCloseTo(Math.min(BAND_SNR_CAP, a.speechBands[i] - a.noiseBands[i]), 9))
    // same scale: the body band of a -25 dBFS voice over -80 dBFS white noise is far above the room
    expect(a.bandSnr[4]).toBeGreaterThan(30)
    expect(a.tones.every((t) => t.db < 12)).toBe(true)
    expect(a.noiseKind).toBe('quiet')
  })

  it('finds steady 780 + 1560 Hz tones in silence and speech', () => {
    const x = syntheticTake({ noiseDb: -50, speechDb: -30, tones: [{ hz: 780, db: -48 }, { hz: 1560, db: -52 }] })
    const a = analyze(x, 48000) as Analysis
    expect(isAnalysisError(a)).toBe(false)
    expect(a.bandSnr).toHaveLength(9)
    expect(a.snr).toBeLessThan(30)
    expect(a.tones.length).toBeGreaterThanOrEqual(2)
    expect(a.tones.length).toBeLessThanOrEqual(6)
    expect(a.tones.some((t) => near(t.hz, 780, 0.03))).toBe(true)
    expect(a.tones.some((t) => near(t.hz, 1560, 0.03))).toBe(true)
    expect(a.tones[0].db).toBeGreaterThanOrEqual(a.tones[a.tones.length - 1].db)
    for (const t of a.tones) {
      expect(Number.isInteger(t.hz)).toBe(true)
      expect(Math.round(t.db * 10) / 10).toBe(t.db)
      expect(t.hz).toBeGreaterThanOrEqual(90)
      expect(t.hz).toBeLessThanOrEqual(8000)
    }
    expect(a.noiseKind).toBe('tonal')
  })

  it('does not report mains hum as a tone', () => {
    const x = syntheticTake({ noiseDb: -50, speechDb: -30, tones: [{ hz: 100, db: -45 }] })
    const a = analyze(x, 48000) as Analysis
    expect(a.tones.some((t) => near(t.hz, 100, 0.02))).toBe(false)
    expect(a.noiseKind).toBe('hum')
  })

  it('fills NaN and no tones when there is no silence block', () => {
    // at 3 kHz an 8192-sample block is 2.7 s, longer than the 0.5–2.8 s silence window
    const a = analyze(syntheticTake({ sampleRate: 3000, speechSec: 20 }), 3000) as Analysis
    expect(isAnalysisError(a)).toBe(false)
    expect(a.hum).toEqual([])
    expect(a.noiseBands).toHaveLength(9)
    expect(a.noiseBands.every(Number.isNaN)).toBe(true)
    expect(a.bandSnr.every(Number.isNaN)).toBe(true)
    expect(a.tones).toEqual([])
  })
})

describe('over-processing signals (v0.8)', () => {
  it('a natural take has no digital silence and no gate flips', () => {
    const a = analyze(syntheticTake({ noiseDb: -60 }), 48000) as Analysis
    expect(a.zeroRatio).toBe(0)
    expect(a.gateSwitches).toBe(0)
  })

  it('clamps the noise floor at -100 dBFS on digital silence and measures cut-outs', () => {
    const x = syntheticTake({ noiseDb: -60 })
    const sr = 48000
    x.fill(0, 0, 3 * sr) // silence window cut to digital zero
    for (let s = 3 * sr; s < x.length; s += sr / 2) x.fill(0, s, s + sr / 10) // 100 ms cut every 500 ms
    const a = analyze(x, sr) as Analysis
    expect(isAnalysisError(a)).toBe(false)
    expect(a.noise).toBe(FLOOR_DB)
    expect(Number.isFinite(a.snr)).toBe(true)
    expect(a.snr).toBeCloseTo(a.speechMed - FLOOR_DB, 6)
    expect(a.zeroRatio).toBeGreaterThan(0.3)
    expect(a.gateSwitches).toBeGreaterThan(12)
    // digital silence in the noise bands reads at the floor, and the per-band SNR is capped (v1.1)
    expect(a.noiseBands.every((v) => v === bandFloorDb(8192))).toBe(true)
    expect(a.bandSnr.every((v) => Number.isFinite(v) && v <= BAND_SNR_CAP)).toBe(true)
    expect(Math.max(...a.bandSnr)).toBe(BAND_SNR_CAP)
  })

  it('puts the band noise floor at -100 dBFS on the long-term spectrum scale', () => {
    // a full-scale white noise (RMS 1) sums to about n * sum(w^2) / 2 over the one-sided spectrum
    expect(bandFloorDb(8192)).toBeCloseTo(FLOOR_DB + 71.0, 1)
  })

  it('counts exact-zero runs: >= 10 ms for zeroRatio, starts of >= 20 ms runs per 10 s for gateSwitches', () => {
    const sr = 1000
    const x = new Float32Array(10 * sr).fill(0.1)
    x.fill(0, 1000, 1005) // 5 ms: quantization-length zeros, ignored
    x.fill(0, 2000, 2015) // 15 ms: digital silence, not a cut-out
    x.fill(0, 3000, 3025) // 25 ms: a cut-out
    x.fill(0, 9900) // 100 ms at the end: a cut-out
    expect(digitalSilence(x, sr)).toEqual({ zeroRatio: (15 + 25 + 100) / 10000, gateSwitches: 2 })
    expect(digitalSilence(x.subarray(0, 5 * sr), sr).gateSwitches).toBe(2) // 1 start in 5 s
    expect(digitalSilence(new Float32Array(0), sr)).toEqual({ zeroRatio: 0, gateSwitches: 0 })
  })

  it('a very quiet room (-80 to -95 dBFS) with speech pauses, quantized to 16 bit, is not flagged', () => {
    const sr = 48000
    for (const noiseDb of [-80, -88, -95]) {
      const x = syntheticTake({ noiseDb })
      const room = syntheticTake({ noiseDb, speechDb: -300 })
      for (let s = 3 * sr; s < x.length; s += sr) x.set(room.subarray(s, s + 0.3 * sr), s) // 300 ms pause every second
      for (let i = 0; i < x.length; i++) x[i] = Math.round(x[i] * 32768) / 32768
      expect(x.some((v) => v === 0)).toBe(true) // quantization does leave single zero samples
      const a = analyze(x, sr) as Analysis
      expect(isAnalysisError(a)).toBe(false)
      expect([a.zeroRatio, a.gateSwitches]).toEqual([0, 0])
      expect(diagnose(a).find((c) => c.id === 'overprocessed')).toBeUndefined()
    }
  })

  it('30 % of the take in 50–300 ms zero gaps is flagged', () => {
    const sr = 48000
    const x = syntheticTake({ noiseDb: -60 })
    const rnd = prng(7)
    let zeroed = 0
    for (let s = Math.round(0.1 * sr); zeroed < 0.3 * x.length && s < x.length; ) {
      const len = Math.round((0.05 + 0.25 * rnd()) * sr)
      x.fill(0, s, s + len)
      zeroed += Math.min(len, x.length - s)
      s += len + Math.round((0.15 + 0.4 * rnd()) * sr)
    }
    const a = analyze(x, sr) as Analysis
    expect(isAnalysisError(a)).toBe(false)
    expect(a.zeroRatio).toBeGreaterThan(0.25)
    expect(a.gateSwitches).toBeGreaterThan(12)
    expect(diagnose(a).find((c) => c.id === 'overprocessed')?.status).toBe('bad')
  })
})
