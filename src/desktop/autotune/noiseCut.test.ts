// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { b64encode } from '../../wavelink/fxp'
import { eqValues } from '../advice/chain'
import type { ChainSlot, Change } from '../advice/types'
import { readReaFir, readReaFirProfile } from '../reafir/state'
import { steadyTonesOf } from '../spectrum/steady'
import type { ToneFound } from '../spectrum/tones'
import { noiseStretches, voiceNoiseOf, type NoiseRegion, type VoiceNoise } from '../spectrum/voiceNoise'
import type { TakeSummary, TuneResult } from '../tune'
import { gateLowsEdits } from '../tune/gateLows'
import { testTake } from '../tune/testTake'
import type { WlChainEntry } from '../types'
import { editManual, remeasured, type ManualEdit } from './manualEq'
import { fitRemover, GROUP_CUT_MAX_OCT, planNoiseCut, REMOVER_MAX_RENDERS, TONE_GROUP_OCT, type NoiseCutAmount } from './noiseCut'

vi.mock('../tune/gateLows', () => ({ GATE_IGNORE_LOWS_HZ: 300, gateLowsEdits: vi.fn(() => []) }))
vi.mock('../spectrum/steady', async (importOriginal) => {
  const real = await importOriginal<typeof import('../spectrum/steady')>()
  return { steadyTonesOf: vi.fn(real.steadyTonesOf) }
})
// the real measures by default; fitRemover's tests read them from a table by the strength rendered
vi.mock('../spectrum/voiceNoise', async (importOriginal) => {
  const real = await importOriginal<typeof import('../spectrum/voiceNoise')>()
  return { ...real, noiseStretches: vi.fn(real.noiseStretches), voiceNoiseOf: vi.fn(real.voiceNoiseOf) }
})
vi.mock('./manualEq', async (importOriginal) => {
  const real = await importOriginal<typeof import('./manualEq')>()
  return { ...real, remeasured: vi.fn(real.remeasured) }
})

const SR = 48000
const NOTES = 'desktop.autotune.ui.noiseCut.notes'
const GATE_EDIT = { slot: 1, key: 'detectorHpHz', to: 300 }

/** A ReaFIR state as the plugin saves it without a profile (lead 4764): FFT 4096, two points, mode EQ. */
function firState(): string {
  const tail = new DataView(new ArrayBuffer(4 * (13 + 4)))
  tail.setFloat32(0, -90, true)
  tail.setFloat32(4, 24, true)
  tail.setInt32(8, 4096, true)
  tail.setFloat32(12, 1, true)
  tail.setInt32(24, 2, true)
  tail.setFloat32(28, 382.45, true)
  tail.setFloat32(36, 3202.73, true)
  const size = 4 + tail.byteLength
  const b = new Uint8Array(160 + size)
  const v = new DataView(b.buffer)
  ;['CcnK', '', 'FBCh', '', 'refr'].forEach((s, k) => [...s].forEach((c, i) => (b[4 * k + i] = c.charCodeAt(0))))
  v.setInt32(156, size, false)
  v.setUint32(160, 4764, true)
  b.set(new Uint8Array(tail.buffer), 164)
  return b64encode(b)
}

type Band = { type: 'Band' | 'Low Shelf' | 'High Shelf'; on: boolean; freqHz: number; gainDb: number; bwOct: number }
const band = (freqHz: number, gainDb = 0, on = true, type: Band['type'] = 'Band'): Band => ({ type, on, freqHz, gainDb, bwOct: 1 })

const eqSlot = (index: number, bands: Band[], on = true): ChainSlot => ({ index, kind: 'reaeq', name: 'ReaEQ (ReaPlugs Edition)', on, values: eqValues(bands) })
const firSlot = (index: number, on = true): ChainSlot => ({ index, kind: 'reafir', name: 'ReaFIR (ReaPlugs Edition)', on, values: {} })
const gateSlot: ChainSlot = { index: 1, kind: 'reagate', name: 'ReaGate (ReaPlugs Edition)', on: true, values: { thresholdDb: -50 } }
const entry = (index: number, parameterState: string): WlChainEntry => ({ index, id: `id${index}`, name: 'x', vendor: 'Cockos', filePath: '', pluginId: '', bypassed: false, parameterState })

const tone = (freqHz: number, overDb: number): ToneFound => ({ freqHz, overDb, levelDb: -50 })
const silent = new Float32Array(SR)
const withTones = (tones: ToneFound[]): void => {
  vi.mocked(steadyTonesOf).mockReturnValueOnce(tones)
}
const cutAt = (edits: { slot: number; key: string; to: number }[], n: number): Record<string, number> =>
  Object.fromEntries(edits.filter((e) => e.key.startsWith(`band${n}.`)).map((e) => [e.key.slice(e.key.indexOf('.') + 1), e.to]))

beforeEach(() => {
  vi.mocked(gateLowsEdits).mockClear()
  vi.mocked(steadyTonesOf).mockClear()
})

describe('planNoiseCut: ReaFIR', () => {
  // 3 s quiet lead and 6 s of speech-like syllables over white room noise at −60 dBFS, with a steady 950 Hz whistle
  const take = testTake({ speechSec: 6, noiseDb: -60, seed: 3 })
  for (let i = 0; i < take.length; i++) take[i] += 10 ** (-40 / 20) * Math.sin((2 * Math.PI * 950 * i) / SR)
  const chain = [gateSlot, eqSlot(2, [band(150, 0, true, 'Low Shelf'), band(1200, 0, false), band(6000)]), firSlot(5)]
  const entries = [entry(5, firState()), entry(2, ''), entry(1, '')]

  it('the first switched-on ReaFIR (matched by slot index) gets Subtract with the take noise; the whistle gets a cut', () => {
    vi.mocked(gateLowsEdits).mockReturnValueOnce([GATE_EDIT])
    const plan = planNoiseCut(take, chain, entries, 'normal')
    expect(plan.notes).toEqual([])
    expect(plan.reafir?.slot).toBe(5)
    expect(readReaFir(plan.reafir?.state ?? '')).toEqual({ mode: 'subtract', fftSize: 4096, hasProfile: true })
    // the profile stands out at the whistle (point j at j · 48000 / 8192 Hz)
    const p = readReaFirProfile(plan.reafir?.state ?? '') ?? new Float32Array(0)
    const db = (hz: number): number => 20 * Math.log10(p[Math.round((hz * 8192) / 48000)])
    expect(db(950) - db(2000)).toBeGreaterThan(10)
    // one narrow cut at the whistle on the free band nearest it (band 2, off: switched on), then the gate edit
    expect(steadyTonesOf).toHaveBeenCalledWith(take, SR)
    const cut = cutAt(plan.edits, 2)
    expect(cut.freqHz).toBeCloseTo(950, -1)
    expect(cut.bwOct).toBe(0.1)
    expect(cut.gainDb).toBeLessThan(-3)
    expect(cut.on).toBe(1)
    expect(plan.edits.map((e) => e.key)).toEqual(['band2.freqHz', 'band2.bwOct', 'band2.gainDb', 'band2.on', 'detectorHpHz'])
    expect(plan.edits.every((e) => e.slot === 2 || e === GATE_EDIT)).toBe(true)
    expect(gateLowsEdits).toHaveBeenCalledWith(chain)
  })

  it('the amount moves the whole profile: light −6 dB, strong +6 dB', () => {
    const at = (amount: 'light' | 'normal' | 'strong'): Float32Array => readReaFirProfile(planNoiseCut(take, chain, entries, amount).reafir?.state ?? '') ?? new Float32Array(0)
    const [light, normal, strong] = [at('light'), at('normal'), at('strong')]
    for (const j of [50, 162, 700, 2000]) {
      expect(20 * Math.log10(strong[j] / normal[j])).toBeCloseTo(6, 3)
      expect(20 * Math.log10(light[j] / normal[j])).toBeCloseTo(-6, 3)
    }
  })

  it('notes: no ReaFIR, a switched-off one, an unknown state, a take without noise to measure', () => {
    withTones([])
    expect(planNoiseCut(silent, [gateSlot], [], 'normal')).toEqual({ reafir: null, remover: null, edits: [], notes: [{ key: `${NOTES}.noReaFir` }] })
    withTones([])
    expect(planNoiseCut(silent, [firSlot(5, false)], entries, 'normal').notes).toEqual([{ key: `${NOTES}.noReaFir` }])
    withTones([])
    expect(planNoiseCut(silent, [firSlot(5)], [entry(5, b64encode(Uint8Array.from([9])))], 'normal').notes).toEqual([{ key: `${NOTES}.reaFirUnknown` }])
    withTones([])
    expect(planNoiseCut(silent, [firSlot(5)], [entry(4, firState())], 'normal').notes).toEqual([{ key: `${NOTES}.reaFirUnknown` }])
    withTones([])
    expect(planNoiseCut(silent, [firSlot(5)], entries, 'normal')).toEqual({ reafir: null, remover: null, edits: [], notes: [{ key: `${NOTES}.noNoise` }] })
  })

  it('a second ReaFIR after a switched-off one is the one used', () => {
    withTones([])
    const plan = planNoiseCut(take, [firSlot(3, false), firSlot(5)], [entry(3, firState()), ...entries], 'normal')
    expect(plan.reafir?.slot).toBe(5)
  })
})

describe('planNoiseCut: steady tones', () => {
  const free = [band(150, 0, true, 'Low Shelf'), band(1200), band(6000, 0, false), band(10000, 0, true, 'High Shelf')]

  it('tones within a sixth of an octave share one cut at their geometric mean, wide enough for both', () => {
    withTones([tone(3000, 30), tone(900, 20), tone(950, 10)])
    const plan = planNoiseCut(silent, [eqSlot(2, free)], [], 'normal')
    // the strongest group first: 3000 Hz takes the free band nearest it (6000 Hz, off → switched on)
    expect(cutAt(plan.edits.slice(0, 4), 3)).toEqual({ freqHz: 3000, bwOct: 0.1, gainDb: -24, on: 1 })
    // 900 + 950 Hz: one cut on the other free band, depth from the stronger (20 + 3 dB)
    const pair = cutAt(plan.edits.slice(4), 2)
    expect(pair.freqHz).toBeCloseTo(Math.sqrt(900 * 950), 1)
    expect(pair.bwOct).toBe(Math.ceil((Math.log2(950 / 900) + 0.1) * 100) / 100)
    expect(pair.bwOct).toBeLessThanOrEqual(GROUP_CUT_MAX_OCT)
    expect(pair.gainDb).toBe(-23)
    expect(pair.on).toBeUndefined()
    expect(plan.edits).toHaveLength(7)
    // (no ReaFIR in this chain)
    expect(plan.notes).toEqual([{ key: `${NOTES}.noReaFir` }])
  })

  it('a sixth of an octave apart is one group, a little more is two', () => {
    const hi = 1000 * 2 ** TONE_GROUP_OCT
    withTones([tone(1000, 10), tone(hi * 0.9999, 10)])
    expect(planNoiseCut(silent, [eqSlot(2, free)], [], 'normal').edits.filter((e) => e.key.endsWith('.freqHz'))).toHaveLength(1)
    withTones([tone(1000, 10), tone(hi * 1.01, 10)])
    expect(planNoiseCut(silent, [eqSlot(2, free)], [], 'normal').edits.filter((e) => e.key.endsWith('.freqHz'))).toHaveLength(2)
  })

  it('every cut takes its own free band; a tone left without one gets a note', () => {
    withTones([tone(500, 25), tone(2000, 20), tone(7000, 15), tone(7100, 12)])
    const plan = planNoiseCut(silent, [eqSlot(2, free)], [], 'normal')
    const bands = new Set(plan.edits.map((e) => e.key.split('.')[0]))
    expect([...bands].sort()).toEqual(['band2', 'band3'])
    expect(plan.notes.slice(1)).toEqual([
      { key: `${NOTES}.noBand`, params: { hz: 7000 } },
      { key: `${NOTES}.noBand`, params: { hz: 7100 } },
    ])
  })

  it('bands in use, shelves and a switched-off ReaEQ are never cut; without a ReaEQ every tone is a note', () => {
    withTones([tone(1000, 10)])
    expect(planNoiseCut(silent, [eqSlot(2, [band(150, 0, true, 'Low Shelf'), band(1200, -3)])], [], 'normal').notes).toEqual([{ key: `${NOTES}.noReaFir` }, { key: `${NOTES}.noBand`, params: { hz: 1000 } }])
    withTones([tone(1000, 10)])
    expect(planNoiseCut(silent, [eqSlot(2, free, false)], [], 'normal')).toEqual({ reafir: null, remover: null, edits: [], notes: [{ key: `${NOTES}.noReaFir` }, { key: `${NOTES}.noBand`, params: { hz: 1000 } }] })
    withTones([tone(1000, 10), tone(5000, 10)])
    expect(planNoiseCut(silent, [gateSlot], [], 'normal').notes.slice(1)).toEqual([
      { key: `${NOTES}.noBand`, params: { hz: 1000 } },
      { key: `${NOTES}.noBand`, params: { hz: 5000 } },
    ])
  })

  it('the first switched-on ReaEQ is used; the gate edits come after the tone cuts', () => {
    vi.mocked(gateLowsEdits).mockReturnValueOnce([GATE_EDIT])
    withTones([tone(1000, 10)])
    const chain = [gateSlot, eqSlot(2, free, false), eqSlot(4, free)]
    const plan = planNoiseCut(silent, chain, [], 'normal')
    expect(plan.edits.map((e) => e.slot)).toEqual([4, 4, 4, GATE_EDIT.slot])
    expect(plan.edits.at(-1)).toBe(GATE_EDIT)
    expect(gateLowsEdits).toHaveBeenCalledWith(chain)
  })
})

const NR_SLOT = 0
const nrSlot = (strength: number, on = true): ChainSlot => ({ index: NR_SLOT, kind: 'noiseRemoval', name: 'Elgato Noise Removal', on, values: { strength } })

describe('planNoiseCut: Noise Removal', () => {
  const take = testTake({ speechSec: 6, noiseDb: -60, seed: 3 })
  const chain = [nrSlot(44), gateSlot, eqSlot(2, [band(150, 0, true, 'Low Shelf'), band(1200, 0, false), band(6000)]), firSlot(5)]
  const entries = [entry(5, firState())]

  it('a switched-on Noise Removal is the remover: no ReaFIR state and no ReaFIR note; the whistle cuts stay', () => {
    withTones([tone(950, 20)])
    const plan = planNoiseCut(take, chain, entries, 'normal')
    expect(plan.reafir).toBeNull()
    expect(plan.remover).toEqual({ slot: NR_SLOT, key: 'strength', from: 44 })
    expect(plan.notes).toEqual([])
    expect(plan.edits.map((e) => e.key)).toEqual(['band2.freqHz', 'band2.bwOct', 'band2.gainDb', 'band2.on'])
    // without ReaFIR in the chain either: no note about it
    withTones([])
    expect(planNoiseCut(silent, [nrSlot(10)], [], 'normal')).toEqual({ reafir: null, remover: { slot: NR_SLOT, key: 'strength', from: 10 }, edits: [], notes: [] })
  })

  it('a switched-off Noise Removal (or one without a strength) is not: ReaFIR as before', () => {
    withTones([])
    const plan = planNoiseCut(take, [nrSlot(44, false), ...chain.slice(1)], entries, 'normal')
    expect(plan.remover).toBeNull()
    expect(plan.reafir?.slot).toBe(5)
    withTones([])
    const bare: ChainSlot = { ...nrSlot(0), values: {} }
    expect(planNoiseCut(silent, [bare], [], 'normal')).toEqual({ reafir: null, remover: null, edits: [], notes: [{ key: `${NOTES}.noReaFir` }] })
  })
})

describe('fitRemover', () => {
  interface At {
    under: [number, number, number]
    speechDb?: number
    wordLossDb?: number
    tone?: number[]
  }
  /** The real chain's take (SPEC "Cut the noise"): Noise Removal 44 as tuned, 60 does nothing, 80 works, 95 more. */
  const REAL: Record<number, At> = {
    44: { under: [29.1, 40.1, 60.3] },
    60: { under: [29.2, 40.2, 60.4] },
    70: { under: [36, 45, 61] },
    80: { under: [52.9, 58.9, 63.9] },
    90: { under: [61, 70, 64.5] },
    95: { under: [70.5, 80.7, 65.1], wordLossDb: 1.8 },
  }
  const TONE = [0, 1, -1, 0.5, 0, 0, -2, 1, 0]
  const summary = (speechDb: number, wordLossDb: number, tone: number[]): TakeSummary => ({
    speechDb, peakDb: -8, clipped: 0, pauseDb: -70, snrDb: speechDb + 70, tone, spreadDb: 9, deadSilence: 0, gateSwitches: 0, wordLossDb, cutSpeech: 0, cutEvents: 0, pumpDb: 0, burstDb: NaN, burstEvents: 0, removerCut: NaN, removerCutEvents: NaN,
    score: { level: 0, noise: 0, tone: 0, consistency: 0, damage: 0, total: 0 },
  })
  const changeTo = (to: number): TuneResult['changes'][number] =>
    ({ id: 'tune:0:strength', reason: 'noisyPause', kind: 'value', slot: NR_SLOT, key: 'strength', from: 85, to, stage: 'noise', titleMsg: { key: 'x' } }) as unknown as TuneResult['changes'][number]
  const CHANGE = changeTo(44)
  const goals = { use: 'streaming', style: 'natural', bothers: [], amount: 'medium' } as unknown as TuneResult['goals']
  const result: TuneResult = { changes: [CHANGE], before: summary(-30, 1, TONE), after: summary(-23.5, 1.6, TONE), processed: new Float32Array(1), renders: 6, unmet: [], log: [], goals, limit: 1 }
  const tuned = [nrSlot(44), eqSlot(2, [band(150, 0, true, 'Low Shelf'), band(1200, 0, false), band(6000)])]
  const WHISTLE = editManual(tuned, [], 2, 'band2.gainDb', -20)
  const take = new Float32Array(SR)
  const region = (id: NoiseRegion['id'], underVoiceDb: number): NoiseRegion => ({ id, loHz: 0, hiHz: 0, noiseDb: -23.5 - underVoiceDb, underVoiceDb })
  const strengthIn = (changes: readonly Change[]): number => {
    const nr = changes.filter((c) => c.kind === 'value' && c.slot === NR_SLOT && c.key === 'strength').at(-1)
    return nr && nr.kind === 'value' ? nr.to : NaN
  }

  /** Renders the table: each processed buffer remembers the strength it was rendered at. */
  function fake(table: Record<number, At>) {
    const at = new WeakMap<Float32Array, number>()
    const render = vi.fn(async (changes: readonly Change[]) => {
      const out = new Float32Array(4)
      at.set(out, strengthIn(changes))
      return out
    })
    const row = (processed: Float32Array): At => table[at.get(processed) ?? -1] ?? { under: [0, 0, 0] }
    vi.mocked(noiseStretches).mockReturnValue([{ from: 0, to: SR }])
    vi.mocked(voiceNoiseOf).mockImplementation((audio: Float32Array): VoiceNoise => {
      const u = row(audio).under
      return { freqsHz: new Float32Array(0), voiceDb: new Float32Array(0), noiseDb: new Float32Array(0), voiceLevelDb: -23.5, noiseLevelDb: -60, regions: [region('low', u[0]), region('mid', u[1]), region('high', u[2])] }
    })
    vi.mocked(remeasured).mockImplementation((_t: Float32Array, r: TuneResult, processed: Float32Array): TuneResult => {
      const x = row(processed)
      return { ...r, processed, after: summary(x.speechDb ?? -23.5, x.wordLossDb ?? 1.6, x.tone ?? TONE) }
    })
    return render
  }
  const strengths = (render: ReturnType<typeof fake>): number[] => render.mock.calls.map(([changes]) => strengthIn(changes))
  const fit = (render: ReturnType<typeof fake>, amount: NoiseCutAmount, from = 44, edits: readonly ManualEdit[] = WHISTLE, onStep?: (s: number) => void) =>
    fitRemover({ take, result: { ...result, changes: [changeTo(from)] }, tuned: [nrSlot(from), ...tuned.slice(1)], edits, render, remover: { slot: NR_SLOT, key: 'strength', from }, amount, onStep })

  it('the first strength that takes every region to the target, with the voice as it was (normal: 80 on the real chain)', async () => {
    const render = fake(REAL)
    const onStep = vi.fn()
    const r = await fit(render, 'normal', 44, WHISTLE, onStep)
    expect(r.edit).toEqual({ slot: NR_SLOT, key: 'strength', to: 80 })
    expect(r.note).toBeNull()
    expect(r.renders).toBe(4)
    expect(strengths(render)).toEqual([44, 60, 70, 80])
    expect(onStep.mock.calls.map(([x]) => x)).toEqual([60, 70, 80])
    expect(r.steps.map((x) => x.strength)).toEqual([44, 60, 70, 80])
    // every render carries the result's changes and the whistle cut; the tuner's strength is the hand one there
    const last = render.mock.calls[3][0]
    expect(last).toContainEqual(expect.objectContaining({ slot: 2, key: 'band2.gainDb', to: -20 }))
    expect(last.filter((c) => c.kind === 'value' && c.key === 'strength').map((c) => (c.kind === 'value' ? c.to : NaN))).toEqual([80])
  })

  it('light and strong: 40 and 60 dB under the voice', async () => {
    expect((await fit(fake(REAL), 'light')).edit?.to).toBe(80)
    expect((await fit(fake({ ...REAL, 70: { under: [41, 45, 61] } }), 'light')).edit?.to).toBe(70)
    const strong = await fit(fake(REAL), 'strong')
    expect(strong.edit?.to).toBe(90)
    expect(strong.note).toBeNull()
  })

  it.each<[string, Partial<At>]>([
    ['more word loss', { wordLossDb: 2.7 }],
    ['a lower voice', { speechDb: -25 }],
    ['a tone band moved', { tone: TONE.map((d, i) => (i === 3 ? d + 1.6 : d)) }],
    ['a silent voice', { speechDb: -200 }],
  ])('%s ends the search: the strongest before it that helped, with the limit note', async (_name, harm) => {
    const render = fake({ ...REAL, 90: { ...REAL[90], ...harm } })
    const r = await fit(render, 'strong')
    expect(r.edit).toEqual({ slot: NR_SLOT, key: 'strength', to: 80 })
    expect(r.note).toEqual({ key: `${NOTES}.removerLimit` })
    expect(strengths(render)).toEqual([44, 60, 70, 80, 90])
    expect(r.steps.at(-1)?.intact).toBe(false)
  })

  it('short of the target with the voice intact all the way: the strongest that helped, with the limit note', async () => {
    const r = await fit(fake({ ...REAL, 90: { under: [55, 59, 64] }, 95: { under: [57, 59.5, 64] } }), 'strong')
    expect(r.edit?.to).toBe(95)
    expect(r.note).toEqual({ key: `${NOTES}.removerLimit` })
    expect(r.renders).toBe(6)
  })

  it('nothing lowers the worst region by 3 dB (or the first step harms the voice): null with the no-help note', async () => {
    const flat = Object.fromEntries([44, 60, 70, 80, 90, 95].map((x): [number, At] => [x, { under: [29.1 + (x - 44) / 30, 40, 60] }]))
    const r = await fit(fake(flat), 'normal')
    expect(r.edit).toBeNull()
    expect(r.note).toEqual({ key: `${NOTES}.removerNoHelp` })
    const hurt = await fit(fake({ ...REAL, 60: { ...REAL[60], wordLossDb: 3 } }), 'normal')
    expect(hurt.edit).toBeNull()
    expect(hurt.note).toEqual({ key: `${NOTES}.removerNoHelp` })
    expect(hurt.renders).toBe(2)
  })

  it('already at the target with the whistle cuts alone: null, no note, one render', async () => {
    const render = fake({ 44: { under: [51, 55, 70] } })
    const r = await fit(render, 'normal')
    expect(r).toMatchObject({ edit: null, note: null, renders: 1 })
    expect(strengths(render)).toEqual([44])
  })

  it('only strengths above the current one, never 100, at most REMOVER_MAX_RENDERS of them', async () => {
    const all = Object.fromEntries([0, 60, 70, 80, 90, 95].map((x): [number, At] => [x, { under: [10 + x / 10, 40, 60] }]))
    const from0 = fake({ ...all, 100: { under: [90, 90, 90] } })
    await fit(from0, 'strong', 0)
    expect(strengths(from0)).toEqual([0, 60, 70, 80, 90, 95])
    expect(strengths(from0).length - 1).toBeLessThanOrEqual(REMOVER_MAX_RENDERS)
    const from85 = fake({ 85: { under: [10, 40, 60] }, 90: { under: [20, 40, 60] }, 95: { under: [30, 40, 60] } })
    const r = await fit(from85, 'strong', 85)
    expect(strengths(from85)).toEqual([85, 90, 95])
    expect(r.edit?.to).toBe(95)
    const top = fake({ 95: { under: [10, 40, 60] } })
    expect(await fit(top, 'normal', 95)).toMatchObject({ edit: null, note: { key: `${NOTES}.removerNoHelp` }, renders: 1 })
  })
})
