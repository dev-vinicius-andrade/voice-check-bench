// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { analyze } from '../../audio/analyze'
import { BANDS, deviations } from '../../audio/reference'
import { isAnalysisError } from '../../types'
import { eq } from '../advice/testFixtures'
import type { ChainSlot } from '../advice/types'
import { calibrate, EqCurves, eqHandles, guideRange, planTone } from './eqModel'
import { fakeRenderer } from './fakeRenderer'
import { bandsOfCells, measure, prepareTake, robustTone, toneLevel } from './measure'
import { LEVEL_REGRESS_SHARE, levelPoints, scoreOf, trimGain, worseBecause } from './score'
import { targetsOf, toneExcess } from './targets'
import { testTake } from './testTake'
import type { TuneGoals, TuneScore } from './types'

const goals = (g: Partial<TuneGoals> = {}): TuneGoals => ({ use: 'streaming', style: 'natural', bothers: [], amount: 'medium', ...g })
const take = testTake({ speechDb: -21, noiseDb: -70 })
const mask = prepareTake(take)
if (!mask) throw new Error('test take not analysable')

describe('prepareTake / measure', () => {
  it('measures the raw take as analyze() does', () => {
    const a = analyze(take, 48000)
    if (isAnalysisError(a)) throw new Error(a.error)
    const m = measure(mask, take)
    expect(m.speechDb).toBeCloseTo(a.speechMed, 6)
    expect(m.peakDb).toBeCloseTo(a.peak, 6)
    expect(m.spreadDb).toBeCloseTo(a.spread, 6)
    expect(m.pauseDb).toBeCloseTo(a.noise, 0)
    expect(m.wordLossDb).toBe(0)
    expect(m.deadSilence).toBe(0)
    expect(m.silent).toBe(false)
    const e = bandsOfCells(m.cells)
    e.forEach((v, i) => expect(v - e[4], BANDS[i].name).toBeCloseTo(a.rel[i], 6))
  })

  it('keeps speech, pauses and windows apart', () => {
    const speech = new Set(mask.speech)
    expect(mask.speech.length).toBeGreaterThan(100)
    expect(mask.pause.length).toBeGreaterThan(40)
    expect(mask.pause.some((f) => speech.has(f) || speech.has(f - 1) || speech.has(f + 1))).toBe(false)
    expect(mask.windows.length).toBeGreaterThan(20)
    expect(mask.loud.length + mask.quiet.length).toBeLessThanOrEqual(mask.speech.length + 1)
  })

  it('a take without speech cannot be prepared', () => {
    expect(prepareTake(new Float32Array(48000 * 5))).toBeNull()
  })

  it('sees what a chain did on the same frames: gain, a closed gate, digital silence', () => {
    const louder = take.map((v) => v * 2)
    expect(measure(mask, louder).speechDb).toBeCloseTo(measure(mask, take).speechDb + 6.02, 1)
    expect(measure(mask, louder).snrDb).toBeCloseTo(measure(mask, take).snrDb, 1)

    // the quietest quarter of the speech frames turned down 12 dB: word loss
    const cut = take.slice()
    for (const f of mask.quiet) for (let i = f * mask.win; i < (f + 1) * mask.win; i++) cut[i] *= 0.25
    expect(measure(mask, cut).wordLossDb).toBeGreaterThan(8)

    // pauses zeroed: dead silence, pause noise on the floor
    const dead = take.slice()
    for (const f of mask.pause) dead.fill(0, f * mask.win, (f + 1) * mask.win)
    const d = measure(mask, dead)
    expect(d.deadSilence).toBeGreaterThan(0.1)
    expect(d.pauseDb).toBe(-100)
    expect(measure(mask, new Float32Array(take.length)).silent).toBe(true)
  })
})

describe('robustTone', () => {
  const ref = BANDS.map((b) => b.ref)

  it('is zero on the reference curve at any level, and follows the style', () => {
    for (const v of robustTone(ref.map((r) => r - 17), 'natural')) expect(v).toBeCloseTo(0, 9)
    const warm = robustTone(ref, 'warm')
    expect(warm[1]).toBeCloseTo(-3, 9)
    expect(warm[3]).toBeCloseTo(0, 9)
  })

  it('a deep low-cut does not push the other bands up (the plain mean does)', () => {
    const rel = ref.map((r, i) => r + (i === 1 ? -20 : i === 2 ? -8 : 0))
    const mean = deviations(rel)
    const robust = robustTone(rel, 'natural')
    expect(mean[5]).toBeCloseTo(4, 1)
    for (let b = 3; b <= 7; b++) expect(robust[b], `band ${b}`).toBeCloseTo(0, 9)
    expect(robust[1]).toBeCloseTo(-20, 9)
    expect(robust[2]).toBeCloseTo(-8, 9)
  })

  it('up to three loud bands do not move the level; repairing them leaves the others where they were', () => {
    const rel = ref.map((r, i) => r + (i === 1 ? 7 : i === 2 ? 4 : i === 7 ? 5 : 0))
    expect(toneLevel(rel, 'natural')).toBeCloseTo(toneLevel(ref, 'natural'), 9)
    expect(robustTone(rel, 'natural')[7]).toBeCloseTo(5, 9)
  })

  it('is unknown with fewer than three usable bands', () => {
    expect(robustTone(ref.map((r, i) => (i === 3 || i === 4 ? r : NaN)), 'natural').every(Number.isNaN)).toBe(true)
  })
})

describe('targets and score', () => {
  it('bothers move the targets, tolerances, weights and caps', () => {
    const base = targetsOf(goals())
    expect(base).toMatchObject({ speechDb: -21, peakCeilDb: -2, snrDb: 30, spreadDb: 8, allowDeadSilence: false })
    expect(base.caps).toMatchObject({ eqStepDb: 4, eqTotalDb: 12, nrStep: 20, nrMax: 40, gateDb: 10, ratio: 3 })
    const t = targetsOf(goals({ bothers: ['boomy', 'roomNoise', 'tooQuiet', 'unevenVolume'] }))
    expect(t).toMatchObject({ speechDb: -19, snrDb: 45, spreadDb: 6, allowDeadSilence: false })
    expect(t.shift.slice(0, 4)).toEqual([0, 1.5, 1.5, 0])
    expect(t.tolHigh.slice(0, 4)).toEqual([3, 1, 1, 3])
    expect(t.tolLow.slice(0, 4)).toEqual([3, 3, 3, 3])
    expect(t.weight.slice(0, 4)).toEqual([0, 2, 2, 1])
    expect(t.caps.ratio).toBe(4)
    expect(targetsOf(goals({ use: 'calls' }))).toMatchObject({ snrDb: 25, spreadDb: 10 })
    expect(targetsOf(goals({ use: 'recording' }))).toMatchObject({ snrDb: 30, spreadDb: 10 })
    expect(targetsOf(goals({ bothers: ['roomNoise'], amount: 'strong' })).allowDeadSilence).toBe(true)
    expect(targetsOf(goals({ use: 'recording', bothers: ['roomNoise'], amount: 'strong' })).allowDeadSilence).toBe(false)
    // opposite complaints cancel the shift and keep both sides tight
    const both = targetsOf(goals({ bothers: ['boomy', 'thin'] }))
    expect([both.shift[1], both.tolHigh[1], both.tolLow[1]]).toEqual([0, 1, 1])
    // limit scales the caps
    expect(targetsOf(goals(), 0.5).caps).toMatchObject({ eqStepDb: 2, eqTotalDb: 6, nrStep: 10, nrMax: 20, gateDb: 5, ratio: 2 })
    expect(targetsOf(goals({ amount: 'light' })).caps.eqStepDb).toBe(2)
    expect(targetsOf(goals({ amount: 'strong' })).caps.eqStepDb).toBe(6)
  })

  it('tone excess counts only what is outside the tolerance, on the complained side from 1 dB', () => {
    const t = targetsOf(goals({ bothers: ['sharpS'] }))
    const dev = [0, 2.9, -3.5, 0, 0, 0, 4, 0.2, 0]
    const e = toneExcess(dev, t)
    expect(e[1]).toBe(0)
    expect(e[2]).toBeCloseTo(0.5, 9)
    expect(e[6]).toBeCloseTo(1, 9)
    expect(e[7]).toBeCloseTo(0.7, 9)
  })

  it('level: the final trim is counted between stages, the peak ceiling limits it', () => {
    const t = targetsOf(goals())
    const m = { ...measure(mask, take), speechDb: -31, peakDb: -8 }
    expect(levelPoints(m, t)).toBeCloseTo(9, 9)
    // 10 dB wanted, 6 dB of peak room: 4 dB stay missing
    expect(trimGain(m, t, { down: -6, up: 18 })).toBeCloseTo(6, 9)
    expect(scoreOf(m, t, { down: -6, up: 18 }).level).toBeCloseTo(3, 9)
    expect(scoreOf(m, t, null).level).toBeCloseTo(9, 9)
    expect(trimGain(m, t, { down: 0, up: 2 })).toBe(2)
    expect(scoreOf({ ...m, clipped: 3 }, t).level).toBeCloseTo(24, 9)
  })

  it('noise, consistency and damage parts', () => {
    const t = targetsOf(goals())
    const m = measure(mask, take)
    expect(scoreOf({ ...m, snrDb: 20 }, t).noise).toBeCloseTo(15, 9)
    expect(scoreOf({ ...m, snrDb: 80 }, t).noise).toBe(0)
    // "room noise" aims at 45 dB: a noisy take keeps paying for every dB it loses (no dead zone under the cap)
    const quiet = targetsOf(goals({ bothers: ['roomNoise'] }))
    expect(scoreOf({ ...m, snrDb: 15 }, quiet).noise).toBeCloseTo(45, 9)
    expect(scoreOf({ ...m, snrDb: 12.5 }, quiet).noise).toBeCloseTo(48.75, 9)
    expect(scoreOf({ ...m, snrDb: -5 }, quiet).noise).toBeCloseTo(67.5, 9)
    expect(scoreOf({ ...m, spreadDb: 12 }, t).consistency).toBeCloseTo(6, 9)
    expect(scoreOf({ ...m, deadSilence: 0.3 }, t).damage).toBeCloseTo(35, 9)
    expect(scoreOf({ ...m, wordLossDb: 4 }, t).damage).toBeCloseTo(6, 9)
    const allowed = targetsOf(goals({ bothers: ['roomNoise'], amount: 'strong' }))
    expect(scoreOf({ ...m, deadSilence: 0.3, snrDb: 60 }, allowed).damage).toBe(0)
    expect(scoreOf({ ...m, deadSilence: 0.3, wordLossDb: 4, snrDb: 60 }, allowed).damage).toBeCloseTo(6, 9)
  })

  it('worseBecause: needs a real gain, guards the other parts, never trades damage', () => {
    const s = (p: Partial<TuneScore>): TuneScore => {
      const v = { level: 0, noise: 0, tone: 0, consistency: 0, damage: 0, ...p }
      return { ...v, total: v.level + v.noise + v.tone + v.consistency + v.damage }
    }
    expect(worseBecause(s({ tone: 10 }), s({ tone: 6 }), 'tone')).toBeNull()
    expect(worseBecause(s({ tone: 10 }), s({ tone: 9.8 }), 'tone')).toMatch(/no gain/)
    // 4 points won on tone allow 1.5 + 1 on another part
    expect(worseBecause(s({ tone: 10 }), s({ tone: 6, level: 2.4 }), 'tone')).toBeNull()
    expect(worseBecause(s({ tone: 10 }), s({ tone: 6, level: 2.6 }), 'tone')).toMatch(/level got worse/)
    expect(worseBecause(s({ noise: 30 }), s({ noise: 0, damage: 2 }), 'noise')).toMatch(/damage got worse/)
    expect(worseBecause(s({ noise: 30 }), s({ noise: 0, damage: 2 }), 'noise', true)).toBeNull()
    // the level stages: the other parts may give up to what the level wins, damage still nothing
    expect(worseBecause(s({ level: 10 }), s({ level: 0, tone: 5 }), 'level')).toMatch(/tone got worse/)
    expect(worseBecause(s({ level: 10 }), s({ level: 0, tone: 5 }), 'level', false, LEVEL_REGRESS_SHARE)).toBeNull()
    expect(worseBecause(s({ level: 10 }), s({ level: 0, damage: 2 }), 'level', false, LEVEL_REGRESS_SHARE)).toMatch(/damage got worse/)
  })
})

describe('EQ model', () => {
  const chain: ChainSlot[] = [eq()]

  function spectrumOf(tone: readonly number[]): { cells: Float64Array; curves: EqCurves; x: Float32Array } {
    const x = testTake({ speechDb: -21, noiseDb: -85, tone, speechSec: 8 })
    const mk = prepareTake(x)
    if (!mk) throw new Error('not analysable')
    return { cells: measure(mk, x).cells, curves: new EqCurves(eqHandles(chain, 4, () => false), mk.cellHz, 48000), x }
  }

  it('lists the tunable bands with the guide ranges and the amount step', () => {
    const hs = eqHandles([eq([{ type: 'Low Shelf', on: true, freqHz: 150, gainDb: -7, bwOct: 2 }, { type: 'Band', on: true, freqHz: 1000, gainDb: 0, bwOct: 0.1 }, { type: 'Band', on: false, freqHz: 450, gainDb: 0, bwOct: 1 }, { type: 'High Shelf', on: true, freqHz: 10000, gainDb: 6, bwOct: 2 }])], 4, (b) => b === 8)
    // the notch and the disabled band are not tone controls
    expect(hs.map((h) => h.n)).toEqual([1, 4])
    // −7 can go to −8 (the guide's floor) and up 4; a gain already over the range may only come back, never further up
    expect([hs[0].lo, hs[0].hi]).toEqual([-8, -3])
    expect([hs[1].lo, hs[1].hi]).toEqual([2, 6])
    expect(guideRange('Band', 250)).toEqual([-6, 3])
    expect(guideRange('Band', 3500)).toEqual([-4, 5])
    expect(eqHandles([{ ...eq(), on: false }], 4, () => false)).toEqual([])
  })

  it('plans cuts only where the voice is off, never a lift of the healthy bands', () => {
    const { cells, curves } = spectrumOf([0, 7, 4])
    const t = targetsOf(goals({ bothers: ['boomy'] }))
    const start = curves.handles.map((h) => h.base)
    const plan = planTone(curves, cells, start, start.map(() => 1), t, t.caps.eqTotalDb)
    expect(plan[0]).toBe(-4)
    expect(plan[1]).toBeLessThanOrEqual(-3)
    expect(plan.slice(2)).toEqual([0, 0, 0])
    // nothing to fix: nothing planned
    const flat = spectrumOf([])
    expect(planTone(flat.curves, flat.cells, start, start.map(() => 1), targetsOf(goals()), 12)).toEqual(start)
  })

  it('respects the total EQ budget and the largest step', () => {
    const { cells, curves } = spectrumOf([0, 8, 8, 8, 0, 0, -8, -8, -8])
    const t = targetsOf(goals())
    const start = curves.handles.map((h) => h.base)
    const plan = planTone(curves, cells, start, start.map(() => 1), t, 6)
    expect(plan.reduce((s, g) => s + Math.abs(g), 0)).toBeLessThanOrEqual(6)
    for (const g of plan) expect(Math.abs(g)).toBeLessThanOrEqual(4)
    for (const g of plan) expect(g === 0 || Math.abs(g) >= 1).toBe(true)
  })

  it('calibrate fits what each band really did in the rendered audio', async () => {
    const { cells, curves, x } = spectrumOf([0, 7, 4])
    const mk = prepareTake(x)
    if (!mk) throw new Error('not analysable')
    const start = curves.handles.map((h) => h.base)
    const plan = [-4, -4, 0, 2, 0]
    const renderWith = async (eqGain?: (s: number, n: number, g: number) => number): Promise<Float64Array> => {
      const fake = fakeRenderer(x, chain, eqGain ? { eqGain } : {})
      const out = await fake.render(curves.handles.map((h, i) => ({ id: '', reason: 'tone' as const, titleMsg: { key: '' }, kind: 'value' as const, slot: h.slot.index, key: h.key, from: h.base, to: plan[i] })))
      return measure(mk, out).cells
    }
    const ones = start.map(() => 1)
    const honest = calibrate(curves, cells, await renderWith(), start, plan, ones)
    expect(honest[0]).toBeCloseTo(1, 1)
    expect(honest[1]).toBeCloseTo(1, 1)
    expect(honest[3]).toBeCloseTo(1, 1)
    expect(honest[2]).toBe(1)
    // the low shelf only does half of what it is set to, the 3.5 kHz band does the opposite
    const broken = calibrate(curves, cells, await renderWith((_s, n, g) => (n === 1 ? g / 2 : n === 4 ? -g : g)), start, plan, ones)
    expect(broken[0]).toBeGreaterThan(0.35)
    expect(broken[0]).toBeLessThan(0.65)
    expect(broken[1]).toBeCloseTo(1, 1)
    expect(broken[3]).toBe(0)
    // a band that does nothing is planned out
    const t = targetsOf(goals({ bothers: ['boomy'] }))
    const replan = planTone(curves, cells, start, [0, 1, 1, 1, 1], t, t.caps.eqTotalDb)
    expect(replan[0]).toBe(0)
  })
})
