// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { analyze } from '../audio/analyze'
import { fakeAnalysis, prng, syntheticTake } from '../audio/testSignals'
import type { Analysis, AnalysisResult, MicProfile, StepKey, Take } from '../types'
import type { Msg } from '../plain/types'
import { englishText } from './english'
import { isNotch, joinMsgs, pickSuggestionBase, suggest, suggestionToJson, suggestionToText } from './suggest'

/** English text of a hint (one message, or sentences joined); '' when absent. */
const en = (m: Msg | readonly Msg[] | null | undefined): string =>
  !m ? '' : Array.isArray(m) ? joinMsgs(m, englishText) : englishText(m as Msg)

/** fakeAnalysis with the noisy-room fields set explicitly (empty = no silence window), overridable. */
const an = (over: Partial<Analysis> = {}): Analysis => ({
  ...fakeAnalysis(),
  speechBands: [],
  noiseBands: [],
  bandSnr: [],
  tones: [],
  noiseKind: 'quiet',
  ...over,
})

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
    const loud = suggest(mkTake(an({ noise: -20, speechMed: -5 })), '8 cm')
    expect(loud?.gate.threshold).toBe(-30)
    expect(loud?.comp.threshold).toBe(-12)
    expect(loud?.comp.wet).toBe(0)
    const quiet = suggest(mkTake(an({ noise: -120, speechMed: -60 })), '8 cm')
    expect(quiet?.gate.threshold).toBe(-72)
    expect(quiet?.comp.threshold).toBe(-45)
    expect(quiet?.comp.wet).toBe(18)
    const rnd = prng(7)
    for (let n = 0; n < 200; n++) {
      const s = suggest(mkTake(an({ noise: -130 + rnd() * 120, speechMed: -70 + rnd() * 68 })), '8 cm')
      expect(s?.gate.threshold).toBeGreaterThanOrEqual(-72)
      expect(s?.gate.threshold).toBeLessThanOrEqual(-30)
      expect(s?.comp.wet).toBeGreaterThanOrEqual(0)
      expect(s?.comp.wet).toBeLessThanOrEqual(18)
    }
  })

  it('uses the prototype gate/comp formulas', () => {
    const s = suggest(mkTake(an({ noise: -70, speechMed: -24 })), '8 cm')
    // gate: min(noise+12, speech-25) = -58 ; comp: speech-6 = -30, out = -30 + 6/3 = -28, makeup = 8
    expect(s?.gate).toEqual({ threshold: -58, attack: 1, hold: 150, release: 200, hysteresis: -6, wet: 0, dry: -20 })
    expect(s?.comp).toEqual({ threshold: -30, ratio: 3, attack: 5, release: 100, knee: 6, wet: 8, limit: true })
    expect(s?.gainHint).toBeNull()
    expect(s?.eq).toEqual([])
    expect(s?.lowcut).toBe(80)
    expect(s?.deess).toBe(false)
  })

  it('EQ gains are multiples of 0.5 with |gain| >= 1, inside their clamps', () => {
    const rnd = prng(42)
    const limits: Record<number, [number, number]> = { 150: [-8, 2], 250: [-6, 3], 450: [-5, 3], 1000: [-4, 4], 3500: [-4, 5], 10000: [-4, 5] }
    for (let n = 0; n < 300; n++) {
      const rel = [0, 0, 0, 0, 0, 0, 0, 0, 0].map((_, i) => (i === 4 ? 0 : -20 + rnd() * 30))
      const s = suggest(mkTake(an({ rel })), '8 cm')
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
    const s = suggest(mkTake(an({ rel, speechMed: -40 })), '8 cm')
    const off = 10 / 7
    const shelf = s?.eq.find((e) => e.type === 'Low Shelf')
    expect(shelf?.gain).toBe(Math.round(-(10 - off) * 0.7 * 2) / 2)
    expect(en(shelf?.why)).toBe(`Boom +${(10 - off).toFixed(1)} dB on the raw mic`)
    expect(s?.lowcut).toBe(120)
    expect(en(s?.gainHint)).toBe('The raw take is quiet (-40 dBFS). Raise the Wave XLR gain about 10 dB first, then record the control takes again. The gate and compressor values depend on it.')
    const hot = suggest(mkTake(an({ speechMed: -10 })), '8 cm')
    expect(en(hot?.gainHint)).toBe('The raw take is hot (-10 dBFS). Lower the Wave XLR gain about 10 dB and record the control takes again.')
  })
  it('on a noisy input keeps the gate above the reduced noise, caps the high shelf and explains why', () => {
    const s = suggest(mkTake(an({ noise: -37, speechMed: -25, snr: 12 })), '8 cm')
    // the gate runs after ReaFIR: it opens above the estimated noise after reduction (noise - 10)
    expect(s?.gate.threshold).toBeGreaterThan(-37 - 10)
    expect(en(s?.noiseHint)).toMatch(/only 12 dB under your voice/)
    const hs = s?.eq.find((e) => e.type === 'High Shelf')
    if (hs) expect(hs.gain).toBeLessThanOrEqual(2)
    expect(suggestionToText(s!)).toMatch(/FIRST: The input is noisy/)
  })

  it('JSON has exactly the SPEC keys in order', () => {
    const s = suggest(mkTake(an({ speechMed: -24.04, noise: -71.26 })), '8 cm')
    if (!s) throw new Error('no suggestion')
    const j = suggestionToJson(s)
    expect(Object.keys(j)).toEqual(['basedOn', 'speechDbfs', 'noiseDbfs', 'gainHint', 'noiseHint', 'dist', 'lowcut', 'gate', 'eq', 'comp', 'deess', 'noisyRoom', 'noiseReduction', 'chain'])
    expect(Object.keys(j.gate)).toEqual(['threshold', 'attack', 'hold', 'release', 'hysteresis', 'wet', 'dry'])
    expect(Object.keys(j.comp)).toEqual(['threshold', 'ratio', 'attack', 'release', 'knee', 'wet', 'limit'])
    expect(j.basedOn).toBe('Take 1')
    expect(j.speechDbfs).toBe(-24)
    expect(j.noiseDbfs).toBe(-71.3)
    expect(j.noisyRoom).toBe(false)
    expect(j.noiseReduction).toBeNull()
    expect(j.chain).toEqual(['ReaGate', 'ReaEQ', 'ReaComp'])
    expect(JSON.parse(JSON.stringify(j))).toEqual(j)
  })

  it('text sheet lists every plugin', () => {
    const rel = [-18, -4 + 6, -1, 2, 0, -6, -7 - 6, -11, -17]
    const s = suggest(mkTake(an({ rel })), '8 cm')
    if (!s) throw new Error('no suggestion')
    const t = suggestionToText(s)
    expect(t.split('\n')[0]).toBe('Voice Check Bench · suggested settings')
    expect(t).toContain('Based on: Take 1 (speech -22.0 dBFS, noise -80 dBFS)')
    expect(t).toContain('Keep the mic at 8 cm. Point the capsule at your mouth.')
    const endMic = suggest({ ...s!.base, mic: { model: 'Any', kind: 'dynamic', pattern: 'cardioid', address: 'end' } }, '8 cm')
    expect(suggestionToText(endMic!)).toContain('Keep the mic at 8 cm. Speak straight into the top of the mic.')
    expect(t).toContain('  Lowcut Filter: on, 80 Hz')
    expect(t).toContain('  Threshold: -68 dB')
    expect(t).toMatch(/ {2}Band 1: Type Low Shelf · Frequency 150 Hz · Gain -\d\.\d dB · Bandwidth 2\.00 oct {3}\(Boom \+\d\.\d dB on the raw mic\)/)
    expect(t).toMatch(/Type Band · Frequency 3500 Hz · Gain \+\d\.\d dB · Bandwidth 1\.40 oct/)
    expect(t).toContain('  Wet (makeup): +')
    expect(t.endsWith('Elgato De-Esser: off\nVoice Focus, Elgato EQ, Elgato Noise Removal: off')).toBe(true)
    // quiet room: same layout as before v0.2
    expect(t).toContain('  Lowcut Filter: on, 80 Hz\n\nEffects order: ReaGate → ReaEQ → ReaComp\n\nReaGate\n  Threshold')
    expect(t).toContain('  Dry: -20 dB\n\nReaEQ (use these bands only')
    expect(t).toMatch(/oct {3}\([^)]*\)\n\nReaComp\n {2}Threshold/)
    expect(t).toContain('  Limit output: on\n\nElgato De-Esser')
    expect(t).not.toContain('ReaFIR')
    expect(t).not.toContain('(notch)')
  })
})

/** A take in a server room: voice 18 dB over the room, top bands drowned, fan tones. */
const noisyRoom = (over: Partial<Analysis> = {}): Analysis =>
  an({
    noise: -40,
    speechMed: -22,
    snr: 18,
    speechBands: [-50, -38, -34, -32, -30, -36, -38, -44, -52],
    noiseBands: [-55, -46, -48, -42, -50, -58, -56, -52, -56],
    bandSnr: [5, 8, 14, 10, 20, 22, 18, 8, 4],
    tones: [
      { hz: 6200, db: 30 },
      { hz: 410.3, db: 22 },
      { hz: 1830, db: 13 },
      { hz: 900, db: 12 },
      { hz: 2400, db: 10 },
    ],
    noiseKind: 'tonal',
    ...over,
  })

const mic = (kind: MicProfile['kind']): MicProfile => ({ model: 'Any Mic 1', kind, pattern: 'cardioid', address: 'end' })

describe('suggest in a noisy room (SNR < 25)', () => {
  it('quiet room: no noise reduction, gate first, and the noisy-room fields change nothing', () => {
    const rel = [-18, 0, -1, 2, 0, -6, -12, -11, -17]
    const plain = suggest(mkTake(an({ rel })), '8 cm')
    expect(plain?.noisyRoom).toBe(false)
    expect(plain?.noiseReduction).toBeNull()
    expect(plain?.chain).toEqual(['ReaGate', 'ReaEQ', 'ReaComp'])
    const withRoom = suggest(mkTake(noisyRoom({ rel, noise: -80, snr: 58 })), '8 cm', mic('condenser'))
    expect(withRoom?.eq).toEqual(plain?.eq)
    expect(withRoom?.gate).toEqual(plain?.gate)
    expect(withRoom?.comp).toEqual(plain?.comp)
    expect(withRoom?.noiseHint).toEqual([])
    expect(withRoom?.chain).toEqual(['ReaGate', 'ReaEQ', 'ReaComp'])
  })

  it('puts ReaFIR first with a Subtract plan and alternatives', () => {
    const s = suggest(mkTake(noisyRoom()), '8 cm')
    expect(s?.noisyRoom).toBe(true)
    expect(s?.chain).toEqual(['ReaFIR', 'ReaEQ', 'ReaComp', 'ReaGate'])
    const nr = s?.noiseReduction
    expect(nr?.plugin).toBe('ReaFIR')
    expect(nr?.steps).toHaveLength(6)
    expect(en(nr?.steps[0])).toBe('In Wave Link → your mic → Effects, add "ReaFIR (ReaPlugs Edition)" and drag it to the top.')
    expect(en(nr?.steps[1])).toBe('Mode: Subtract. FFT size: 4096.')
    expect(en(nr?.steps[2])).toMatch(/Automatically build noise profile/)
    expect(en(nr?.steps[3])).toBe(
      'Drag the whole curve down a little (about 6 dB), then talk and listen. Stop at the first watery or robotic sound; if it never sounds clean, use an AI noise remover instead.',
    )
    expect(en(nr?.steps[5])).toBe('After noise removal your voice may get quieter: raise ReaComp Wet by the same amount (the results show how much).')
    expect(nr?.alternatives.map(englishText)).toEqual(['Elgato Noise Removal (in Wave Link)', 'Voice Focus by ai-coustics (in Wave Link)', 'NVIDIA Broadcast — Noise Removal (RTX GPUs)'])
    // never a fixed 15 dB room drop, also when the voice is close to the room
    const loud = suggest(mkTake(noisyRoom({ snr: 12 })), '8 cm')?.noiseReduction
    expect(en(loud?.steps[3])).toContain('6 dB')
    expect(loud?.steps.map(englishText).join(' ')).not.toContain('15 dB')
    expect(suggest(mkTake(noisyRoom({ snr: 24.9 })), '8 cm')?.noisyRoom).toBe(true)
    expect(suggest(mkTake(noisyRoom({ snr: 25 })), '8 cm')?.noisyRoom).toBe(false)
  })

  it('adds at most 3 notches for tones >= 12 dB, strongest first, after the tonal bands', () => {
    const s = suggest(mkTake(noisyRoom()), '8 cm')
    const n = s?.eq.filter(isNotch) ?? []
    expect(n.map((e) => [e.freq, e.gain])).toEqual([[6200, -12], [410, -11], [1830, -6.5]])
    for (const e of n) {
      expect(e.type).toBe('Band')
      expect(e.bw).toBe(0.1)
      expect(e.gain).toBeGreaterThanOrEqual(-12)
      expect(e.gain).toBeLessThanOrEqual(-6)
    }
    expect(en(n[0].why)).toBe('Fan/machine tone +30.0 dB')
    expect(s?.eq.slice(-n.length)).toEqual(n)
    expect(suggest(mkTake(noisyRoom({ tones: [{ hz: 500, db: 11.9 }] })), '8 cm')?.eq.filter(isNotch)).toEqual([])
    // quiet room: tones never become notches
    expect(suggest(mkTake(noisyRoom({ snr: 40 })), '8 cm')?.eq.filter(isNotch)).toEqual([])
  })

  it('never boosts a band whose voice-over-room SNR is below 12 dB', () => {
    const idx: Record<number, number[]> = { 150: [1], 250: [2], 450: [3], 1000: [4], 3500: [6], 10000: [7, 8] }
    const rnd = prng(11)
    for (let n = 0; n < 300; n++) {
      const rel = [0, 0, 0, 0, 0, 0, 0, 0, 0].map((_, i) => (i === 4 ? 0 : -25 + rnd() * 30))
      const bandSnr = rel.map(() => rnd() * 30)
      const s = suggest(mkTake(noisyRoom({ rel, bandSnr })), '8 cm')
      for (const e of s?.eq ?? []) {
        if (isNotch(e)) continue
        const snr = Math.min(...idx[e.freq].map((i) => bandSnr[i]))
        if (snr < 12) expect(e.gain).toBeLessThanOrEqual(0)
        if (e.type === 'High Shelf') expect(e.gain).toBeLessThanOrEqual(2)
      }
    }
    // unknown band SNR (no silence window): boosts are allowed
    const thin = [-18, -4 - 8, -1 - 8, 2, 0, -6, -7 - 8, -11, -17]
    expect(suggest(mkTake(noisyRoom({ rel: thin, bandSnr: [] })), '8 cm')?.eq.some((e) => e.gain > 0)).toBe(true)
    expect(suggest(mkTake(noisyRoom({ rel: thin, bandSnr: [20, 8, 8, 20, 20, 20, 8, 20, 20] })), '8 cm')?.eq.some((e) => e.gain > 0)).toBe(false)
  })

  it('turns the high shelf into a cut when the room dominates above 5 kHz', () => {
    const hs = (bandSnr: number[]) => suggest(mkTake(noisyRoom({ bandSnr })), '8 cm')?.eq.find((e) => e.type === 'High Shelf')
    expect(hs([5, 8, 14, 10, 20, 22, 18, 8, 6])).toMatchObject({ freq: 10000, gain: -2, why: { key: 'engine.suggest.why.roomAbove5k' } })
    expect(hs([5, 8, 14, 10, 20, 22, 18, 4, 3])).toMatchObject({ gain: -4, why: { key: 'engine.suggest.why.roomAbove5k' } })
    expect(en(hs([5, 8, 14, 10, 20, 22, 18, 12, 6])?.why) || 'Sibilance').toMatch(/^Sibilance/)
  })

  it('soft-expander gate and gentler compressor that does not pump the room up', () => {
    const s = suggest(mkTake(noisyRoom()), '8 cm')
    // gate: noise - 4 = -44 (6 dB over the noise after ~10 dB reduction)
    expect(s?.gate).toEqual({ threshold: -44, attack: 1, hold: 200, release: 300, hysteresis: -6, wet: 0, dry: -10 })
    expect(s?.gate.threshold).toBeGreaterThan(-40 - 10)
    // comp: speech - 4 = -26, out = -26 + 4/2.5 = -24.4, aim 4.4; cap -(-50) - 45 = 5 -> 4
    expect(s?.comp).toEqual({ threshold: -26, ratio: 2.5, attack: 5, release: 100, knee: 6, wet: 4, limit: true })
    // makeup capped by the room: noise -37 -> cap 2 even though -20 dBFS needs 12
    expect(suggest(mkTake(noisyRoom({ noise: -37, speechMed: -30 })), '8 cm')?.comp.wet).toBe(2)
    expect(suggest(mkTake(noisyRoom({ noise: -60, speechMed: -30 })), '8 cm')?.comp.wet).toBe(12)
    const rnd = prng(3)
    for (let n = 0; n < 200; n++) {
      const s2 = suggest(mkTake(noisyRoom({ noise: -100 + rnd() * 95, speechMed: -70 + rnd() * 68 })), '8 cm')
      expect(s2?.gate.threshold).toBeGreaterThanOrEqual(-72)
      expect(s2?.gate.threshold).toBeLessThanOrEqual(-30)
      expect(s2?.comp.threshold).toBeGreaterThanOrEqual(-45)
      expect(s2?.comp.threshold).toBeLessThanOrEqual(-12)
      expect(s2?.comp.wet).toBeGreaterThanOrEqual(0)
      expect(s2?.comp.wet).toBeLessThanOrEqual(18)
    }
  })

  it('adds the condenser hint from the mic profile, with no model names', () => {
    const hint = ' Condenser mics pick up more of the room: stay closer and lower the gain.'
    const cond = suggest(mkTake(noisyRoom()), '8 cm', mic('condenser'))
    expect(en(cond?.noiseHint).endsWith('the closer to 30 dB, the cleaner.' + hint)).toBe(true)
    expect(en(cond?.noiseHint)).not.toContain('Any Mic 1')
    expect(en(suggest(mkTake(noisyRoom()), '8 cm', mic('dynamic'))?.noiseHint).endsWith('the closer to 30 dB, the cleaner.')).toBe(true)
    expect(en(suggest(mkTake(noisyRoom()), '8 cm')?.noiseHint).endsWith('the closer to 30 dB, the cleaner.')).toBe(true)
    // default: the mic stored on the take; an explicit mic wins
    const onTake: Take = { ...mkTake(noisyRoom()), mic: mic('condenser') }
    expect(en(suggest(onTake, '8 cm')?.noiseHint).endsWith(hint)).toBe(true)
    expect(en(suggest(onTake, '8 cm', mic('dynamic'))?.noiseHint).endsWith(hint)).toBe(false)
  })

  it('preferAi: AI noise removal first when the voice is less than 15 dB over the room', () => {
    const at = (snr: number) => suggest(mkTake(noisyRoom({ snr })), '8 cm')
    expect(at(12)?.noiseReduction?.preferAi).toBe(true)
    expect(at(14.9)?.noiseReduction?.preferAi).toBe(true)
    expect(at(15)?.noiseReduction?.preferAi).toBe(false)
    expect(at(20)?.noiseReduction?.preferAi).toBe(false)
    const s = at(12)
    if (!s) throw new Error('no suggestion')
    // the chain keeps ReaFIR; the sheet marks it optional and lists the AI options before it
    expect(s.chain).toEqual(['ReaFIR', 'ReaEQ', 'ReaComp', 'ReaGate'])
    expect(s.gate.dry).toBe(-10)
    const t = suggestionToText(s)
    expect(t).toContain('Effects order: ReaFIR (optional) → ReaEQ → ReaComp → ReaGate')
    const tryFirst = t.indexOf('Try first (AI noise removal): Elgato Noise Removal (in Wave Link), Voice Focus by ai-coustics (in Wave Link), NVIDIA Broadcast — Noise Removal (RTX GPUs). If your voice sounds clean with one of them, skip ReaFIR.')
    const reafir = t.indexOf('ReaFIR (noise reduction, optional: only if the AI option does not sound clean)\n  1. In Wave Link')
    expect(tryFirst).toBeGreaterThan(0)
    expect(reafir).toBeGreaterThan(tryFirst)
    expect(t).not.toContain('Alternatives:')
    expect(t).not.toContain('15 dB')
    const j = suggestionToJson(s)
    expect(j.noiseReduction?.preferAi).toBe(true)
    expect(suggestionToJson(at(20)!).noiseReduction?.preferAi).toBe(false)
  })

  it('text sheet: chain order, ReaFIR steps, alternatives and notches', () => {
    const s = suggest(mkTake(noisyRoom()), '8 cm')
    if (!s) throw new Error('no suggestion')
    const t = suggestionToText(s)
    expect(t).toContain('Effects order: ReaFIR → ReaEQ → ReaComp → ReaGate\n\nReaFIR (noise reduction)\n  1. In Wave Link')
    expect(t).toContain('  2. Mode: Subtract. FFT size: 4096.')
    expect(t).toContain('  4. Drag the whole curve down a little (about 6 dB), then talk and listen.')
    expect(t).toContain('  5. Keep ReaEQ, ReaComp and ReaGate below ReaFIR, in that order.')
    expect(t).toContain('  6. After noise removal your voice may get quieter: raise ReaComp Wet by the same amount (the results show how much).')
    expect(t).toContain('  Alternatives: Elgato Noise Removal (in Wave Link), Voice Focus by ai-coustics (in Wave Link), NVIDIA Broadcast — Noise Removal (RTX GPUs)')
    expect(t).toMatch(/Type Band \(notch\) · Frequency 6200 Hz · Gain -12\.0 dB · Bandwidth 0\.10 oct {3}\(Fan\/machine tone \+30\.0 dB\)/)
    expect(t).toContain('  Ratio: 2.5:1')
    expect(t).toContain('  Dry: -10 dB')
    const pos = ['\nReaFIR (noise reduction)\n', '\nReaEQ (use', '\nReaComp\n', '\nReaGate\n'].map((h) => t.indexOf(h))
    expect(pos.every((p) => p >= 0)).toBe(true)
    expect([...pos].sort((x, y) => x - y)).toEqual(pos)
  })

  it('JSON carries the noisy-room fields after deess', () => {
    const s = suggest(mkTake(noisyRoom()), '8 cm')
    if (!s) throw new Error('no suggestion')
    const j = suggestionToJson(s)
    expect(Object.keys(j).slice(-4)).toEqual(['deess', 'noisyRoom', 'noiseReduction', 'chain'])
    expect(j.noisyRoom).toBe(true)
    expect(j.chain).toEqual(['ReaFIR', 'ReaEQ', 'ReaComp', 'ReaGate'])
    expect(Object.keys(j.noiseReduction ?? {})).toEqual(['plugin', 'steps', 'alternatives', 'preferAi'])
    expect(JSON.parse(JSON.stringify(j))).toEqual(j)
  })
})

describe('pickSuggestionBase', () => {
  const ok = (rel: number[], snr = 58) => an({ rel, snr })
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
