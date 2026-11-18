// @vitest-environment node
// Behaviours the person's real chain exposed (tools/tune-real, SPEC "Tune from a recording (desktop)" → Real chain),
// pinned on synthetic data: what a shelf lifts, plans that lift the room, how the tone check reads an EQ move, and
// when a gate's input can be read from a render.
import { describe, expect, it } from 'vitest'
import { comp, eq, gate, noiseRemoval } from '../advice/testFixtures'
import type { ChainSlot } from '../advice/types'
import { eqHandles, touched } from './eqModel'
import { bandsOfCells, CELLS_PER_BAND, measure, prepareTake, robustTone, type Measured } from './measure'
import { Session } from './session'
import { gateInputDb } from './stages'
import { targetsOf } from './targets'
import { testTake } from './testTake'
import { alignedTone, respectBothers, withoutLifts } from './toneStage'
import type { TuneGoals } from './types'

const goals = (g: Partial<TuneGoals> = {}): TuneGoals => ({ use: 'streaming', style: 'natural', bothers: [], amount: 'medium', ...g })
const take = testTake({ speechDb: -24, noiseDb: -55 })
const maybeMask = prepareTake(take)
if (!maybeMask) throw new Error('test take not analysable')
const mask = maybeMask
const m0 = measure(mask, take)

describe('EQ lifts in a noisy room', () => {
  it('a shelf lifts every band past its corner, so a noisy rumble keeps a 150 Hz low shelf from going up', () => {
    expect(touched({ type: 'Low Shelf', freqHz: 150 })).toEqual([0, 1])
    expect(touched({ type: 'High Shelf', freqHz: 10000 })).toEqual([7, 8])
    expect(touched({ type: 'Band', freqHz: 250 })).toEqual([2])
    const hs = eqHandles([eq()], 4, (b) => b === 0)
    expect(hs.find((h) => h.type === 'Low Shelf')?.hi).toBe(0)
    expect(hs.find((h) => h.freqHz === 250)?.hi).toBe(3)
  })

  it('after a plan brought the room up, bands touching a loud room may not rise above where the chain had them', () => {
    const cut = eq([
      { type: 'Low Shelf', on: true, freqHz: 150, gainDb: 0, bwOct: 2 },
      { type: 'Band', on: true, freqHz: 1000, gainDb: -1.5, bwOct: 1 },
      { type: 'High Shelf', on: true, freqHz: 10000, gainDb: -4, bwOct: 2 },
    ])
    const hs = eqHandles([cut], 4, () => false)
    // the room is loud at 640–1250 Hz and 5–10 kHz
    const strict = withoutLifts(hs, (b) => b === 4 || b === 7)
    expect(strict.map((h) => [h.lo, h.hi])).toEqual([
      [hs[0].lo, hs[0].hi],
      [hs[1].lo, -1.5],
      [hs[2].lo, -4],
    ])
  })
})

describe('EQ moves against a complaint', () => {
  it('"boomy" never lifts a band that reaches boom or warmth, "dull" never cuts the top', () => {
    const hs = eqHandles([eq()], 4, () => false)
    const boomy = respectBothers(hs, targetsOf(goals({ bothers: ['boomy'] })))
    expect(boomy.map((h) => h.hi)).toEqual([0, 0, hs[2].hi, hs[3].hi, hs[4].hi])
    expect(boomy.map((h) => h.lo)).toEqual(hs.map((h) => h.lo))
    const dull = respectBothers(hs, targetsOf(goals({ bothers: ['dull'] })))
    expect(dull[4].lo).toBe(0)
    expect(dull[4].hi).toBe(hs[4].hi)
    expect(respectBothers(hs, targetsOf(goals()))).toEqual(hs)
  })
})

describe('the tone check reads what the EQ did', () => {
  /** `m0` with each band's cells moved by `db[band]` dB and everything by `all` dB. */
  const moved = (db: readonly number[], all: number): Measured => {
    const cells = Float64Array.from(m0.cells, (v, c) => v * 10 ** (((db[Math.floor(c / CELLS_PER_BAND)] ?? 0) + all) / 10))
    return { ...m0, cells }
  }

  it('a cut reaching the median band does not move the bands it never touched; a compressor giving the level back neither', () => {
    const t = targetsOf(goals())
    // −4 dB at 160–320 Hz spilling onto three neighbours (one of them becomes the median), a compressor after it +1 dB
    const plan = [0, -1, -4, -1.5, -1, 0, 0, 0, 0]
    const after = moved(plan, 1)
    const [b, a] = alignedTone(m0, after, plan, t)
    for (const k of [5, 6, 7, 8]) expect(a[k] - b[k], `band ${k}`).toBeCloseTo(0, 6)
    expect(a[2] - b[2]).toBeCloseTo(-4, 6)
    // matched on its own median, presence would read higher without anything touching it
    const own = robustTone(bandsOfCells(after.cells), t.style)
    expect(own[6] - b[6]).toBeGreaterThan(0.5)
  })

  it('a band that did something else than planned stands out', () => {
    const t = targetsOf(goals())
    const plan = [0, 0, -4, 0, 0, 0, 0, 0, 0]
    // presence came up 2 dB nobody planned
    const [b, a] = alignedTone(m0, moved([0, 0, -4, 0, 0, 0, 2, 0, 0], 0), plan, t)
    expect(a[6] - b[6]).toBeCloseTo(2, 6)
  })
})

describe('what a gate behind a compressor receives', () => {
  const t = targetsOf(goals())
  const session = (chain: ChainSlot[]): Session => {
    const s = new Session({ chain, mask, targets: t, render: () => Promise.resolve(take), maxRenders: 16 })
    s.m = m0
    return s
  }
  const after = (v: Parameters<typeof gate>[0]): ChainSlot => ({ ...gate(v), index: 4 })

  it('is the raw take without a compressor before it, or with a noise remover after it', () => {
    const s = session([gate({ thresholdDb: -60, dryDb: 0 }), eq(), comp(12)])
    expect(gateInputDb(s, s.chain[0])).toMatchObject({ measured: false, speechDb: mask.analysis.speechMed, noiseDb: mask.analysis.noise })
    const nrAfter = session([eq(), comp(12), after({ thresholdDb: -60, dryDb: 0 }), { ...noiseRemoval(40), index: 5 }])
    expect(gateInputDb(nrAfter, nrAfter.chain[2]).measured).toBe(false)
  })

  it('is read from the render through a gate that passes everything (doubled: −6 dB of its gain)', () => {
    const s = session([eq(), comp(12), after({ thresholdDb: -60, dryDb: 0 })])
    const lv = gateInputDb(s, s.chain[2])
    expect(lv.measured).toBe(true)
    expect(lv.pausePeakDb).toBeCloseTo(m0.pausePeakDb - 20 * Math.log10(2), 6)
    expect(lv.quietPeakDb).toBeCloseTo(m0.quietPeakDb - 20 * Math.log10(2), 6)
  })

  it('is not read through a gate that closes on some pauses and opens on others', () => {
    const s = session([eq(), comp(12), after({ thresholdDb: m0.pauseDb - 2, dryDb: -20 })])
    const lv = gateInputDb(s, s.chain[2])
    expect(lv.measured).toBe(true)
    expect(lv.pausePeakDb).toBeNaN()
    expect(Number.isFinite(lv.quietPeakDb)).toBe(true)
  })
})
