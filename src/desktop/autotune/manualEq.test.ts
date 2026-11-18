// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { b64decode, readBank } from '../../wavelink/fxp'
import { comp, eq, gate, noiseRemoval } from '../advice/testFixtures'
import type { ChainSlot, SwitchChange, ValueChange } from '../advice/types'
import { chainOf, eqStateValues, PARAM_MAPS } from '../slots'
import { engineSlots, entries, snapshot } from '../testChain'
import { engineChanges, openTuneSession, tune, type TuneBridge, type TuneChange, type TuneResult } from '../tune'
import { fakeRenderer } from '../tune/fakeRenderer'
import { testTake } from '../tune/testTake'
import type { AudioExportedState, AudioSlot } from '../types'
import { allChanges, editManual, manualChain, manualLines, remeasured, tunedChain, type ManualEdit } from './manualEq'

const value = (slot: number, key: string, from: number, to: number): ValueChange => ({ id: `t:${slot}:${key}`, reason: 'tone', titleMsg: { key: 'x' }, kind: 'value', slot, key, from, to })
const tc = (c: ValueChange | SwitchChange, also?: ValueChange[]): TuneChange => ({
  ...c,
  stage: 'tone',
  changeMsg: { key: 'line' },
  effect: { metric: 'speechDb', before: 0, after: 0 },
  ...(also ? { also } : {}),
})
const flip = (slot: number, on: boolean): SwitchChange => ({ id: `t:${slot}:on`, reason: 'tone', titleMsg: { key: 'x' }, kind: 'switch', slot, on })

/** Noise Removal 85 → ReaGate → ReaEQ (guide bands, flat) → ReaComp Wet 6. */
const base = (): ChainSlot[] => [noiseRemoval(), gate(), eq(), comp()]

/** A tune result's changes: Wet 6 → 9, Band 2 (250 Hz) moved to 220 Hz / 1 oct / −4 dB, the gate switched off. */
const changes = (): TuneChange[] => [
  tc(flip(1, false)),
  tc(value(2, 'band2.gainDb', 0, -4), [value(2, 'band2.freqHz', 250, 220), value(2, 'band2.bwOct', 1.5, 1)]),
  tc(value(3, 'wetDb', 6, 9)),
]

describe('tunedChain', () => {
  it('applies value changes, `also` values and switches', () => {
    const t = tunedChain(base(), changes())
    expect(t[1].on).toBe(false)
    expect(t[2].values).toMatchObject({ 'band2.gainDb': -4, 'band2.freqHz': 220, 'band2.bwOct': 1, 'band1.freqHz': 150 })
    expect(t[3].values.wetDb).toBe(9)
    expect(t[0]).toEqual(base()[0])
  })
})

describe('editManual', () => {
  const tuned = tunedChain(base(), changes())

  it('adds an edit with the tuned value as from', () => {
    const e = editManual(tuned, [], 2, 'band3.gainDb', -6)
    expect(e).toEqual([expect.objectContaining({ id: 'manual:2:band3.gainDb', reason: 'tone', kind: 'value', slot: 2, key: 'band3.gainDb', from: 0, to: -6 })])
    expect(e[0].titleMsg.key).toMatch(/^desktop\./)
    // a key the tuner changed starts from the tuner's value
    expect(editManual(tuned, [], 2, 'band2.freqHz', 923)[0]).toMatchObject({ from: 220, to: 923 })
  })

  it('replaces the edit of the same slot and key, keeps the others in place', () => {
    const a = editManual(tuned, [], 2, 'band3.gainDb', -6)
    const b = editManual(tuned, a, 2, 'band4.gainDb', 2)
    const c = editManual(tuned, b, 2, 'band3.gainDb', -9)
    expect(c.map((e) => [e.key, e.to])).toEqual([['band3.gainDb', -9], ['band4.gainDb', 2]])
    expect(c[1]).toBe(b[1])
  })

  it('drops an edit back at the tuned value; returns the same array when nothing changes', () => {
    const a = editManual(tuned, [], 2, 'band2.freqHz', 923)
    expect(editManual(tuned, a, 2, 'band2.freqHz', 220.0001)).toEqual([])
    expect(editManual(tuned, a, 2, 'band2.freqHz', 923)).toBe(a)
    expect(editManual(tuned, a, 2, 'band1.gainDb', 0)).toBe(a)
  })

  it('leaves the edits as they are for an unknown slot or key', () => {
    const a = editManual(tuned, [], 2, 'band3.gainDb', -6)
    expect(editManual(tuned, a, 9, 'band3.gainDb', 1)).toBe(a)
    expect(editManual(tuned, a, 2, 'band9.gainDb', 1)).toBe(a)
    expect(editManual(tuned, a, 2, 'band3.gainDb', NaN)).toBe(a)
  })
})

describe('manualChain', () => {
  it('applies the edits; untouched slots keep their identity', () => {
    const tuned = tunedChain(base(), changes())
    const edits = editManual(tuned, [], 2, 'band2.freqHz', 923)
    const m = manualChain(tuned, edits)
    expect(m[2].values['band2.freqHz']).toBe(923)
    expect(m[2]).not.toBe(tuned[2])
    expect(tuned[2].values['band2.freqHz']).toBe(220)
    ;[0, 1, 3].forEach((i) => expect(m[i]).toBe(tuned[i]))
    expect(manualChain(tuned, []).every((s, i) => s === tuned[i])).toBe(true)
  })
})

describe('allChanges', () => {
  const tuned = tunedChain(base(), changes())
  let edits: readonly ManualEdit[] = []
  edits = editManual(tuned, edits, 3, 'wetDb', 7)
  edits = editManual(tuned, edits, 2, 'band2.freqHz', 923)
  edits = editManual(tuned, edits, 2, 'band4.gainDb', -3)

  it('rewrites the tuner value of an edited key (own value and `also`), appends the rest; one entry per value', () => {
    const all = allChanges(changes(), edits)
    const flat = engineChanges(all)
    const keyOf = (c: (typeof flat)[number]): string => (c.kind === 'switch' ? `${c.slot}:on` : `${c.slot}:${c.key}`)
    expect(new Set(flat.map(keyOf)).size).toBe(flat.length)
    const to = (k: string): number | undefined => {
      const c = flat.find((x) => keyOf(x) === k)
      return c?.kind === 'value' ? c.to : undefined
    }
    expect(to('3:wetDb')).toBe(7)
    expect(to('2:band2.freqHz')).toBe(923)
    expect(to('2:band2.gainDb')).toBe(-4)
    expect(to('2:band4.gainDb')).toBe(-3)
    expect(flat.some((c) => c.kind === 'switch' && c.slot === 1 && !c.on)).toBe(true)
    expect(allChanges(changes(), [])).toEqual(changes())
  })

  it('renders the hand values on the fake chain, whichever way the list is read', async () => {
    const take = testTake({ quietSec: 1, speechSec: 2, speechDb: -24 })
    // the fake chain takes a flat list, as the tuner hands it (engineChanges)
    const { render } = fakeRenderer(take, base())
    const want = await render(engineChanges([...changes(), ...edits]))
    const got = await render(engineChanges(allChanges(changes(), edits)))
    expect(maxDiff(got, want)).toBe(0)
    // read first-wins (each value from its first entry): the same chain
    expect(maxDiff(await render(engineChanges(allChanges(changes(), edits)).reverse()), want)).toBe(0)
    expect(maxDiff(got, await render(engineChanges(changes())))).toBeGreaterThan(1e-4)
  })

  it('on the real session adapter: the hand edit wins in render and in exportChanges (own value and `also` value)', async () => {
    // the test chain (../testChain): Noise Removal 0, ReaGate 1, ReaEQ 2 (Low Shelf 150, Band 3500 / −2 dB / 1.4 oct, High Shelf), ReaComp 3
    const WET = PARAM_MAPS.reacomp?.wetDb
    if (!WET) throw new Error('no ReaComp Wet map')
    const { bridge, states, wet } = fakeBridge()
    const take = Float32Array.from([0.1, -0.2, 0.3])
    const s = await openTuneSession(bridge, take)
    const result = [tc(value(2, 'band2.gainDb', -2, -6), [value(2, 'band2.freqHz', 3500, 3000), value(2, 'band2.bwOct', 1.4, 1)]), tc(value(3, 'wetDb', 0, 12))]
    const tuned = tunedChain(s.chain, result)
    let hand: readonly ManualEdit[] = editManual(tuned, [], 3, 'wetDb', 6)
    hand = editManual(tuned, hand, 2, 'band2.freqHz', 923)
    hand = editManual(tuned, hand, 2, 'band2.gainDb', -12)
    const out = await s.render(allChanges(result, hand))
    expect(out[0]).toBeCloseTo(0.1 * Math.fround(WET.fromUnits(6)), 6)
    expect(wet()).toBe(Math.fround(WET.fromUnits(6)))
    expect(eqStateValues(states.get(2) ?? '')).toMatchObject({ 'band2.freqHz': 923, 'band2.gainDb': expect.closeTo(-12, 4), 'band2.bwOct': 1 })
    const saved = await s.exportChanges(allChanges(result, hand))
    expect(saved.map((c) => c.index)).toEqual([2, 3])
    expect(eqStateValues(saved[0].parameterState ?? '')).toMatchObject({ 'band2.freqHz': 923, 'band2.gainDb': expect.closeTo(-12, 4), 'band2.bwOct': 1 })
    expect(readBank(b64decode(saved[1].parameterState ?? '')).vals[WET.id]).toBe(Math.fround(WET.fromUnits(6)))
    expect(s.chain).toEqual(chainOf(engineSlots(), entries()))
  })
})

/** Largest sample difference (a failed toEqual on whole renders prints for minutes). */
function maxDiff(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return Infinity
  let m = 0
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]))
  return m
}

/** The render session of renderer.test.ts, reduced: records states, renders the take × ReaComp's Wet float. */
function fakeBridge() {
  const WET = PARAM_MAPS.reacomp?.wetDb
  if (!WET) throw new Error('no ReaComp Wet map')
  let slots: AudioSlot[] = engineSlots()
  const states = new Map<number, string>(entries().map((e) => [e.index, e.parameterState]))
  const reply = (index: number): AudioSlot => slots.find((s) => s.index === index) as AudioSlot
  const wet = (): number => reply(3).params.find((p) => p.id === WET.id)?.normalized ?? 1
  const bridge: TuneBridge = {
    renderOpen: async () => ({ sampleRate: 48000, latencySamples: 480, slots: engineSlots() }),
    wavelinkRead: async () => snapshot(),
    renderSetParam: async (slot, id, v) => {
      slots = slots.map((s) => (s.index === slot ? { ...s, params: s.params.map((p) => (p.id === id ? { ...p, normalized: Math.fround(v) } : p)) } : s))
      if (slot === 0) states.set(0, `nr:${v}`)
      return reply(slot)
    },
    renderSetBypass: async (slot) => reply(slot),
    renderLoadState: async (slot, state) => {
      states.set(slot, state)
      return reply(slot)
    },
    renderRun: async (x) => x.map((v) => v * wet()),
    renderExportStates: async (): Promise<AudioExportedState[]> =>
      slots.filter((s) => s.status.status === 'hosted').map((s) => ({ index: s.index, name: s.name, filePath: s.filePath, bypassed: s.bypassed, parameterState: states.get(s.index) ?? '' })),
    renderClose: async () => undefined,
  }
  return { bridge, states, wet }
}

describe('remeasured', () => {
  const goals = { use: 'streaming', style: 'natural', bothers: [], amount: 'medium' } as const
  const setup = async (): Promise<{ take: Float32Array; result: TuneResult; render: ReturnType<typeof fakeRenderer>['render']; chain: ChainSlot[] }> => {
    const take = testTake({ speechDb: -21, noiseDb: -70, speechSec: 8 })
    const chain = [noiseRemoval(20), gate({ thresholdDb: -60 }), eq(), comp(8.5)]
    const { render } = fakeRenderer(take, chain)
    const result = await tune({ take, chain, render, goals: { ...goals, bothers: [] }, maxRenders: 4 })
    return { take, result, render, chain }
  }

  it('measures the same render as the tuner did, and a new render differently; keeps changes, before, unmet', async () => {
    const { take, result, render, chain } = await setup()
    expect(Number.isFinite(result.after.speechDb)).toBe(true)
    const same = remeasured(take, result, result.processed)
    expect(JSON.stringify(same.after)).toBe(JSON.stringify(result.after))

    const tuned = tunedChain(chain, result.changes)
    let hand: readonly ManualEdit[] = editManual(tuned, [], 2, 'band4.gainDb', 9)
    hand = editManual(tuned, hand, 3, 'wetDb', (tuned[3].values.wetDb ?? 0) - 6)
    const processed = await render(engineChanges(allChanges(result.changes, hand)))
    const next = remeasured(take, result, processed)
    expect(next.processed).toBe(processed)
    expect(next.changes).toBe(result.changes)
    expect(next.before).toBe(result.before)
    expect(next.unmet).toBe(result.unmet)
    expect(next.goals).toBe(result.goals)
    expect(next.after.speechDb).toBeLessThan(result.after.speechDb - 3)
    expect(next.after.tone[6]).toBeGreaterThan(result.after.tone[6] + 2)
    // what one render cannot give stays as the tuner measured it
    expect(next.after.cutSpeech).toEqual(result.after.cutSpeech)
    expect(next.after.removerCut).toEqual(result.after.removerCut)
  }, 60_000)

  it('replaces only `processed` when the take cannot be measured', () => {
    const quiet = new Float32Array(48000 * 4)
    const result = { after: { speechDb: NaN } } as unknown as TuneResult
    const processed = new Float32Array(quiet.length)
    const r = remeasured(quiet, result, processed)
    expect(r).toEqual({ after: { speechDb: NaN }, processed })
  })
})

describe('manualLines', () => {
  it('one line per ReaEQ band whose shape moved, with its three values; gains alone and other values as their own lines, in chain order', () => {
    const tuned = tunedChain(base(), changes())
    let e: readonly ManualEdit[] = []
    e = editManual(tuned, e, 3, 'wetDb', 7)
    e = editManual(tuned, e, 2, 'band4.gainDb', -3)
    e = editManual(tuned, e, 2, 'band2.gainDb', -24)
    e = editManual(tuned, e, 2, 'band2.freqHz', 923)
    e = editManual(tuned, e, 2, 'band2.bwOct', 0.1)
    const lines = manualLines(tuned, e)
    expect(lines.map((l) => l.id)).toEqual(['manual:2:band2', 'manual:2:band4.gainDb', 'manual:3:wetDb'])
    expect(lines[0].msg).toEqual({
      key: 'desktop.autotune.change.band',
      params: { plugin: 'ReaEQ', band: 'Band 2', fromHz: 220, fromOct: 1, fromDb: -4, toHz: 923, toOct: 0.1, toDb: -24 },
    })
    expect(lines[1].msg.key).not.toBe('desktop.autotune.change.band')
    expect(lines[2].msg.params).toMatchObject({ from: 9, to: 7 })
    expect(manualLines(tuned, [])).toEqual([])
  })
})
