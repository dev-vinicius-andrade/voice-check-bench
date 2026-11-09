// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { analyze } from '../audio/analyze'
import { fakeAnalysis, prng, syntheticTake } from '../audio/testSignals'
import type { AnalysisResult, StepKey, Take } from '../types'
import { pickSuggestionBase, suggest, suggestionToJson, suggestionToText } from './suggest'

const mkTake = (analysis: AnalysisResult, step: StepKey | null = 'c8', id = 1): Take => ({
  id,
  name: `Take ${id}`,
  session: 's1',
  step,
  device: 'Mic',
  sampleRate: 48000,
  samples: new Float32Array(0),
  created: '2026-01-01T00:00:00.000Z',
  analysis,
})

describe('suggest', () => {
  it('returns null for an unanalyzed base take', () => {
    expect(suggest(mkTake({ error: 'x' }), '8 cm')).toBeNull()
  })

  it('works on a synthetic take', () => {
    const s = suggest(mkTake(analyze(syntheticTake(), 48000)), '8 cm')
    expect(s).not.toBeNull()
    expect(s?.dist).toBe('8 cm')
    expect(s?.gate.threshold).toBeGreaterThanOrEqual(-72)
    expect(s?.gate.threshold).toBeLessThanOrEqual(-30)
  })

  it('clamps the gate threshold to [-72, -30] and comp makeup to [0, 18]', () => {
    const loud = suggest(mkTake(fakeAnalysis({ noise: -20, speechMed: -5 })), '8 cm')
    expect(loud?.gate.threshold).toBe(-30)
    expect(loud?.comp.threshold).toBe(-12)
    expect(loud?.comp.wet).toBe(0)
    const quiet = suggest(mkTake(fakeAnalysis({ noise: -120, speechMed: -60 })), '8 cm')
    expect(quiet?.gate.threshold).toBe(-72)
    expect(quiet?.comp.threshold).toBe(-45)
    expect(quiet?.comp.wet).toBe(18)
    const rnd = prng(7)
    for (let n = 0; n < 200; n++) {
      const s = suggest(mkTake(fakeAnalysis({ noise: -130 + rnd() * 120, speechMed: -70 + rnd() * 68 })), '8 cm')
      expect(s?.gate.threshold).toBeGreaterThanOrEqual(-72)
      expect(s?.gate.threshold).toBeLessThanOrEqual(-30)
      expect(s?.comp.wet).toBeGreaterThanOrEqual(0)
      expect(s?.comp.wet).toBeLessThanOrEqual(18)
    }
  })

  it('uses the prototype gate/comp formulas', () => {
    const s = suggest(mkTake(fakeAnalysis({ noise: -70, speechMed: -24 })), '8 cm')
    // gate: min(noise+12, speech-25) = -58 ; comp: speech-6 = -30, out = -30 + 6/3 = -28, makeup = 8
    expect(s?.gate).toEqual({ threshold: -58, attack: 1, hold: 150, release: 200, hysteresis: -6, wet: 0, dry: -20 })
    expect(s?.comp).toEqual({ threshold: -30, ratio: 3, attack: 5, release: 100, knee: 6, wet: 8, limit: true })
    expect(s?.gainHint).toBe('')
    expect(s?.eq).toEqual([])
    expect(s?.lowcut).toBe(80)
    expect(s?.deess).toBe(false)
  })

  it('EQ gains are multiples of 0.5 with |gain| >= 1, inside their clamps', () => {
    const rnd = prng(42)
    const limits: Record<number, [number, number]> = { 150: [-8, 2], 250: [-6, 3], 450: [-5, 3], 1000: [-4, 4], 3500: [-4, 5], 10000: [-4, 5] }
    for (let n = 0; n < 300; n++) {
      const rel = [0, 0, 0, 0, 0, 0, 0, 0, 0].map((_, i) => (i === 4 ? 0 : -20 + rnd() * 30))
      const s = suggest(mkTake(fakeAnalysis({ rel })), '8 cm')
      for (const e of s?.eq ?? []) {
        expect(Number.isInteger(e.gain * 2)).toBe(true)
        expect(Math.abs(e.gain)).toBeGreaterThanOrEqual(1)
        expect(e.gain).toBeGreaterThanOrEqual(limits[e.freq][0])
        expect(e.gain).toBeLessThanOrEqual(limits[e.freq][1])
      }
    }
  })

  it('cuts boom at 70 %, sets lowcut 120 for rumble and gives the quiet gain hint', () => {
    // boom +10 over reference; level-matching offset = 10/7
    const rel = [-18 + 6, -4 + 10, -1, 2, 0, -6, -7, -11, -17]
    const s = suggest(mkTake(fakeAnalysis({ rel, speechMed: -40 })), '8 cm')
    const off = 10 / 7
    const shelf = s?.eq.find((e) => e.type === 'Low Shelf')
    expect(shelf?.gain).toBe(Math.round(-(10 - off) * 0.7 * 2) / 2)
    expect(shelf?.why).toBe(`Boom +${(10 - off).toFixed(1)} dB on the raw mic`)
    expect(s?.lowcut).toBe(120)
    expect(s?.gainHint).toBe('The raw take is quiet (-40 dBFS). Raise the Wave XLR gain about 10 dB first, then record the control takes again. The gate and compressor values depend on it.')
    const hot = suggest(mkTake(fakeAnalysis({ speechMed: -10 })), '8 cm')
    expect(hot?.gainHint).toBe('The raw take is hot (-10 dBFS). Lower the Wave XLR gain about 10 dB and record the control takes again.')
  })
  it('on a noisy input keeps the gate above the noise, caps the high shelf and explains why', () => {
    const s = suggest(mkTake(fakeAnalysis({ noise: -37, speechMed: -25, snr: 12 })), '8 cm')
    expect(s?.gate.threshold).toBeGreaterThan(-37)
    expect(s?.noiseHint).toMatch(/only 12 dB under your voice/)
    const hs = s?.eq.find((e) => e.type === 'High Shelf')
    if (hs) expect(hs.gain).toBeLessThanOrEqual(2)
    expect(suggestionToText(s!)).toMatch(/FIRST: The input is noisy/)
  })

  it('JSON has exactly the SPEC keys in order', () => {
    const s = suggest(mkTake(fakeAnalysis({ speechMed: -24.04, noise: -71.26 })), '8 cm')
    if (!s) throw new Error('no suggestion')
    const j = suggestionToJson(s)
    expect(Object.keys(j)).toEqual(['basedOn', 'speechDbfs', 'noiseDbfs', 'gainHint', 'noiseHint', 'dist', 'lowcut', 'gate', 'eq', 'comp', 'deess'])
    expect(Object.keys(j.gate)).toEqual(['threshold', 'attack', 'hold', 'release', 'hysteresis', 'wet', 'dry'])
    expect(Object.keys(j.comp)).toEqual(['threshold', 'ratio', 'attack', 'release', 'knee', 'wet', 'limit'])
    expect(j.basedOn).toBe('Take 1')
    expect(j.speechDbfs).toBe(-24)
    expect(j.noiseDbfs).toBe(-71.3)
    expect(JSON.parse(JSON.stringify(j))).toEqual(j)
  })

  it('text sheet lists every plugin', () => {
    const rel = [-18, -4 + 6, -1, 2, 0, -6, -7 - 6, -11, -17]
    const s = suggest(mkTake(fakeAnalysis({ rel })), '8 cm')
    if (!s) throw new Error('no suggestion')
    const t = suggestionToText(s)
    expect(t.split('\n')[0]).toBe('Voice Check Bench · suggested settings')
    expect(t).toContain('Based on: Take 1 (speech -22.0 dBFS, noise -80 dBFS)')
    expect(t).toContain('Keep the mic at 8 cm, speak into the top')
    expect(t).toContain('  Lowcut Filter: on, 80 Hz')
    expect(t).toContain('  Threshold: -68 dB')
    expect(t).toMatch(/ {2}Band 1: Type Low Shelf · Frequency 150 Hz · Gain -\d\.\d dB · Bandwidth 2\.00 oct {3}\(Boom \+\d\.\d dB on the raw mic\)/)
    expect(t).toMatch(/Type Band · Frequency 3500 Hz · Gain \+\d\.\d dB · Bandwidth 1\.40 oct/)
    expect(t).toContain('  Wet (makeup): +')
    expect(t.endsWith('Elgato De-Esser: off\nVoice Focus, Elgato EQ, Elgato Noise Removal: off')).toBe(true)
  })
})

describe('pickSuggestionBase', () => {
  const ok = (rel: number[], snr = 58) => fakeAnalysis({ rel, snr })
  const ref = [-18, -4, -1, 2, 0, -6, -7, -11, -17]
  const boomy = [-18, 6, -1, 2, 0, -6, -7, -11, -17]

  it('prefers the raw take at the processed distance', () => {
    const slots = [mkTake(ok(boomy), 'c2', 1), mkTake(ok(ref), 'c8', 2), mkTake(ok(boomy), 'c15', 3), null]
    expect(pickSuggestionBase(slots, '15 cm')?.id).toBe(3)
  })

  it('falls back to the best control take', () => {
    const slots = [mkTake(ok(boomy), 'c2', 1), mkTake(ok(ref), 'c8', 2), null, null]
    expect(pickSuggestionBase(slots, '15 cm')?.id).toBe(2)
    expect(pickSuggestionBase(slots, null)?.id).toBe(2)
  })

  it('returns null without enough valid takes', () => {
    expect(pickSuggestionBase([mkTake(ok(ref), 'c2', 1), mkTake({ error: 'x' }, 'c8', 2), null, null], '15 cm')).toBeNull()
    expect(pickSuggestionBase([null, null, null, null], null)).toBeNull()
  })
})
