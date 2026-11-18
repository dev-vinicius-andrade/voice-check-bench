// @vitest-environment node
// The seven complaints added with the grouped chips: what each means in targets and what it makes the tuner do on the
// fake chain, and the opposites (they cancel, or one wins).
import { describe, expect, it } from 'vitest'
import { parseTuneGoals } from '../autotune/goals'
import { comp, eq, gate, noiseRemoval } from '../advice/testFixtures'
import type { ChainSlot } from '../advice/types'
import { humDb, measure, prepareTake, topDb, type Measured, type TakeMask } from './measure'
import { fakeRenderer } from './fakeRenderer'
import { scoreOf } from './score'
import { FLAT_LOOSER_DB, HISS_SNR_DB, METALLIC_NR_SHARE, NOISE_PUMPS_WEIGHT, targetsOf, WORDS_CUT_GAP_SHARE, WORDS_CUT_WEIGHT } from './targets'
import { testTake } from './testTake'
import { tune } from './tune'
import { valueChanges, type Bother, type TuneGoals } from './types'

const TIMEOUT = 60_000
const goals = (bothers: Bother[] = [], g: Partial<TuneGoals> = {}): TuneGoals => ({ use: 'streaming', style: 'natural', bothers, amount: 'medium', ...g })
const base = targetsOf(goals())
const keys = (r: { changes: Parameters<typeof valueChanges>[0] }): string[] => valueChanges(r.changes).map((c) => `${c.slot}:${c.key}`)

describe('targets of the new complaints', () => {
  it('words cut off: cut speech counts double, the gate sits nearer the pauses and lets go slower', () => {
    const t = targetsOf(goals(['wordsCut']))
    expect([t.cutWeight, t.gentleGate, t.gateGapShare]).toEqual([WORDS_CUT_WEIGHT, true, WORDS_CUT_GAP_SHARE])
    const m = { ...measure(mask, take), cutShare: 0.03, cutEvents: 3 }
    expect(scoreOf(m, t).damage).toBeCloseTo(WORDS_CUT_WEIGHT * scoreOf(m, base).damage, 6)
  })

  it('metallic: a lighter Noise Removal (step, cap and ceiling), and it wins over hiss and strong room noise', () => {
    const t = targetsOf(goals(['metallic']))
    expect(t.caps.nrMax).toBe(Math.round(base.caps.nrMax * METALLIC_NR_SHARE))
    expect(t.caps.nrStep).toBe(Math.round(base.caps.nrStep * METALLIC_NR_SHARE))
    expect(t.caps.nrCeil).toBe(t.caps.nrMax)
    expect(t.metallic).toBe(true)
    const both = targetsOf(goals(['metallic', 'hiss']))
    expect([both.hissCut, both.snrDb, both.caps.nrMax]).toEqual([false, base.snrDb, t.caps.nrMax])
    expect(targetsOf(goals(['roomNoise'], { amount: 'strong' })).allowDeadSilence).toBe(true)
    expect(targetsOf(goals(['roomNoise', 'metallic'], { amount: 'strong' })).allowDeadSilence).toBe(false)
  })

  it('noise comes and goes: bursts in the pauses and a pumping gate count double', () => {
    const t = targetsOf(goals(['noisePumps']))
    expect([t.burstWeight, t.pumpWeight]).toEqual([NOISE_PUMPS_WEIGHT, NOISE_PUMPS_WEIGHT])
    const m: Measured = { ...measure(mask, take), snrDb: 70, burstDb: 24, pumpDb: 20 }
    expect(scoreOf(m, t).noise).toBeCloseTo(NOISE_PUMPS_WEIGHT * scoreOf(m, base).noise, 6)
    expect(scoreOf(m, t).damage).toBeCloseTo(NOISE_PUMPS_WEIGHT * scoreOf(m, base).damage, 6)
  })

  it('flat: a looser spread with a floor and a lower ratio; flat and uneven volume cancel like too quiet and too loud', () => {
    const t = targetsOf(goals(['flat']))
    expect(t.spreadDb).toBe(base.spreadDb + FLAT_LOOSER_DB)
    expect(t.spreadMinDb).toBe(base.spreadDb - FLAT_LOOSER_DB)
    expect(t.caps.ratio).toBe(base.caps.ratio - 1)
    const m = { ...measure(mask, take), spreadDb: base.spreadDb - FLAT_LOOSER_DB - 3 }
    expect(scoreOf(m, t).consistency).toBeCloseTo(4.5, 6)
    expect(scoreOf(m, base).consistency).toBe(0)
    const both = targetsOf(goals(['flat', 'unevenVolume']))
    expect([both.spreadDb, both.spreadMinDb, both.caps.ratio]).toEqual([base.spreadDb, NaN, base.caps.ratio])
    // both are kept as picked: the tuner, not the list, settles them
    expect(parseTuneGoals({ bothers: ['unevenVolume', 'flat'] }).bothers).toEqual(['unevenVolume', 'flat'])
  })

  it('popping P and B, low hum: the lows under the voice are heard as too much, rumble counts', () => {
    for (const b of ['plosives', 'hum'] as const) {
      const t = targetsOf(goals([b]))
      expect(t.shift[0]).toBeGreaterThan(0)
      expect(t.shift[1]).toBeGreaterThan(0)
      expect(t.weight[0]).toBeGreaterThan(0)
      expect(base.weight[0]).toBe(0)
    }
    expect(targetsOf(goals(['hum'])).humCut).toBe(true)
  })

  it('high hiss: more removal allowed and wanted, and less of the top', () => {
    const t = targetsOf(goals(['hiss']))
    expect(t.snrDb).toBe(Math.max(base.snrDb, HISS_SNR_DB))
    expect(t.caps.nrMax).toBeGreaterThan(base.caps.nrMax)
    expect(t.hissCut).toBe(true)
  })

  it('words cut off is compatible with everything', () => {
    const all = targetsOf(goals(['wordsCut', 'metallic', 'noisePumps', 'flat', 'plosives', 'hum', 'hiss', 'roomNoise']))
    expect(all.gentleGate).toBe(true)
    expect(all.cutWeight).toBe(WORDS_CUT_WEIGHT)
  })
})

const take = testTake({ speechDb: -21, noiseDb: -60 })
const mask = prepareTake(take) as TakeMask

describe('what the new complaints make the tuner do (fake chain)', () => {
  it('words cut off: a gate that only cuts behind a Noise Removal that silences the pauses lets everything through', async () => {
    const chain: ChainSlot[] = [noiseRemoval(85), gate({ thresholdDb: -30, dryDb: -40 }), eq(), comp(6)]
    const run = async (bothers: Bother[]) => tune({ take, chain, render: fakeRenderer(take, chain).render, goals: goals(bothers) })
    const r = await run(['wordsCut'])
    expect(valueChanges(r.changes).find((c) => c.slot === 1 && c.key === 'wetDb')?.to).toBeLessThanOrEqual(-60)
    expect(valueChanges(r.changes).find((c) => c.slot === 1 && c.key === 'dryDb')?.to).toBe(0)
    expect(r.changes.some((c) => c.titleMsg.key === 'desktop.autotune.reason.words.gateOff')).toBe(true)
    expect(r.after.cutSpeech).toBe(0)
    expect(keys(await run([]))).not.toContain('1:dryDb')
  }, TIMEOUT)

  it('metallic: a Noise Removal at 85 comes down to the ceiling, and the result says the room comes back', async () => {
    const noisy = testTake({ speechDb: -21, noiseDb: -50 })
    const chain: ChainSlot[] = [noiseRemoval(85), eq(), comp(6)]
    const r = await tune({ take: noisy, chain, render: fakeRenderer(noisy, chain).render, goals: goals(['metallic']) })
    const nr = valueChanges(r.changes).find((c) => c.slot === 0 && c.key === 'strength')
    expect(nr?.to).toBeLessThanOrEqual(targetsOf(goals(['metallic'])).caps.nrCeil)
    expect(nr?.titleMsg.key).toBe('desktop.autotune.reason.metallic.strength')
    expect(r.unmet.map((u) => u.key)).toContain('desktop.autotune.unmet.metallic')
  }, TIMEOUT)

  it('flat: an over-squeezing compressor lets go and the dynamics come back', async () => {
    const swing = testTake({ speechDb: -30, noiseDb: -75, phraseDb: [0, -8, -3, -10] })
    const chain: ChainSlot[] = [eq(), { ...comp(4), values: { thresholdDb: -40, ratio: 10, attackMs: 5, releaseMs: 100, wetDb: 4 } }]
    const render = fakeRenderer(swing, chain).render
    const r = await tune({ take: swing, chain, render, goals: goals(['flat']) })
    const ratio = valueChanges(r.changes).find((c) => c.key === 'ratio')
    expect(ratio?.to).toBeLessThan(10)
    expect(ratio?.titleMsg.key).toBe('desktop.autotune.reason.flat.ratio')
    expect(r.after.spreadDb).toBeGreaterThan(r.before.spreadDb + 1)
    expect(keys(await tune({ take: swing, chain, render, goals: goals() }))).not.toContain('3:ratio')
  }, TIMEOUT)

  it('popping P and B: the low end comes down where nothing was asked before', async () => {
    const boomy = testTake({ speechDb: -21, noiseDb: -70, tone: [6, 3, 0, 0, 0, 0, 0, 0, 0] })
    const chain: ChainSlot[] = [eq(), comp(6)]
    const render = fakeRenderer(boomy, chain).render
    const r = await tune({ take: boomy, chain, render, goals: goals(['plosives']) })
    const low = valueChanges(r.changes).find((c) => c.slot === 2 && c.key === 'band1.gainDb')
    expect(low?.to).toBeLessThan(0)
    expect(r.after.tone[1]).toBeLessThan(r.before.tone[1])
  }, TIMEOUT)

  it('low hum: a free EQ band goes onto a 60 Hz hum in the pauses, narrow and down', async () => {
    const hummy = take.map((v, i) => v + 0.003 * Math.sin((2 * Math.PI * 60 * i) / 48000))
    const own = prepareTake(hummy) as TakeMask
    expect(own.humHz).toBe(60)
    const chain: ChainSlot[] = [eq([...GUIDE_WITH_FREE]), comp(6)]
    const render = fakeRenderer(hummy, chain).render
    const r = await tune({ take: hummy, chain, render, goals: goals(['hum']) })
    const cut = r.changes.find((c) => c.titleMsg.key === 'desktop.autotune.reason.hum.cut')
    expect(cut).toBeDefined()
    expect(valueChanges(r.changes).find((c) => c.key.endsWith('.freqHz') && c.to === 60)).toBeDefined()
    expect(humDb(own, r.processed)).toBeLessThan(humDb(own, await render([])) - 3)
    // no free band: said, with where to put one
    const full: ChainSlot[] = [eq(GUIDE_BANDS_USED), comp(6)]
    const none = await tune({ take: hummy, chain: full, render: fakeRenderer(hummy, full).render, goals: goals(['hum']) })
    expect(none.unmet.map((u) => u.key)).toContain('desktop.autotune.unmet.hum.noBand')
  }, TIMEOUT)

  it('high hiss: the top shelf comes down when the room rules up there', async () => {
    const hissy = testTake({ speechDb: -21, noiseDb: -40 })
    const own = prepareTake(hissy) as TakeMask
    const top = topDb(own, hissy)
    expect(top.speech - top.pause).toBeLessThan(6)
    const chain: ChainSlot[] = [eq(), comp(6)]
    const r = await tune({ take: hissy, chain, render: fakeRenderer(hissy, chain).render, goals: goals(['hiss']) })
    const shelf = valueChanges(r.changes).find((c) => c.key === 'band5.gainDb')
    expect(shelf?.to).toBeLessThan(0)
    expect(shelf?.titleMsg.key).toBe('desktop.autotune.reason.hiss.shelf')
    const noShelf: ChainSlot[] = [eq(GUIDE_BANDS_USED.filter((b) => b.type !== 'High Shelf')), comp(6)]
    const none = await tune({ take: hissy, chain: noShelf, render: fakeRenderer(hissy, noShelf).render, goals: goals(['hiss']) })
    expect(none.unmet.map((u) => u.key)).toContain('desktop.autotune.unmet.hiss.noShelf')
  }, TIMEOUT)
})

/** The guide's bands plus a free peak band at 0 dB. */
const GUIDE_WITH_FREE = [
  { type: 'Low Shelf', on: true, freqHz: 150, gainDb: 0, bwOct: 2 },
  { type: 'Band', on: true, freqHz: 250, gainDb: -2, bwOct: 1.5 },
  { type: 'Band', on: true, freqHz: 450, gainDb: -1, bwOct: 1.2 },
  { type: 'Band', on: true, freqHz: 1000, gainDb: 0, bwOct: 1 },
  { type: 'Band', on: true, freqHz: 3500, gainDb: 1, bwOct: 1.4 },
  { type: 'High Shelf', on: true, freqHz: 10000, gainDb: 0, bwOct: 2 },
] as const
/** Every peak band already doing something. */
const GUIDE_BANDS_USED = [
  { type: 'Low Shelf', on: true, freqHz: 150, gainDb: 0, bwOct: 2 },
  { type: 'Band', on: true, freqHz: 250, gainDb: -2, bwOct: 1.5 },
  { type: 'Band', on: true, freqHz: 450, gainDb: -1, bwOct: 1.2 },
  { type: 'Band', on: true, freqHz: 3500, gainDb: 1, bwOct: 1.4 },
  { type: 'High Shelf', on: true, freqHz: 10000, gainDb: 0, bwOct: 2 },
] as const
