// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { PEAK_WARN_DB, TARGET_SPEECH_DB } from '../../audio/diagnose'
import { comp, eq, gate, noiseRemoval } from '../advice/testFixtures'
import type { ChainSlot } from '../advice/types'
import { fakeRenderer, type FakeOptions } from './fakeRenderer'
import { DEFAULT_MAX_RENDERS } from './session'
import { toneExcess, targetsOf } from './targets'
import { testTake, type TestTakeOptions } from './testTake'
import { retune, tune } from './tune'
import type { TuneGoals, TuneInput, TuneResult, TuneStage } from './types'

const TIMEOUT = 60_000
const goalsOf = (g: Partial<TuneGoals> = {}): TuneGoals => ({ use: 'streaming', style: 'natural', bothers: [], amount: 'medium', ...g })

/** Noise Removal 20 → ReaGate (soft, threshold −60) → ReaEQ (the guide's bands, flat) → ReaComp (−30 dB, 3:1). */
const fullChain = (wet = 0): ChainSlot[] => [noiseRemoval(20), gate({ thresholdDb: -60 }), eq(), comp(wet)]
/** The same chain with the make-up that puts a −21 dBFS take on the level target. */
const GOOD_WET = 8.5

interface Run {
  result: TuneResult
  calls: number
  input: TuneInput
}

async function run(take: Partial<TestTakeOptions>, chain: ChainSlot[], goals: Partial<TuneGoals> = {}, extra: Partial<TuneInput> = {}, fake: FakeOptions = {}): Promise<Run> {
  const x = testTake({ speechDb: -21, noiseDb: -80, ...take })
  const { render, calls } = fakeRenderer(x, chain, fake)
  const input: TuneInput = { take: x, chain, render, goals: goalsOf(goals), ...extra }
  const result = await tune(input)
  return { result, calls: calls.length, input }
}

const keysOf = (r: TuneResult): string[] => r.changes.map((c) => `${c.slot}:${c.key}`)
const unmetKeys = (r: TuneResult): string[] => r.unmet.map((m) => m.key.replace('desktop.autotune.unmet.', ''))

describe('tune: level', () => {
  it('raises a quiet take to the target without clipping', async () => {
    const { result: r } = await run({ speechDb: -38, noiseDb: -85 }, fullChain())
    expect(r.before.speechDb).toBeLessThan(-30)
    expect(keysOf(r)).toEqual(['3:wetDb'])
    const c = r.changes[0]
    expect(c.to).toBeGreaterThan(c.from)
    expect(c.stage).toBe('level')
    expect(c.reason).toBe('tooQuiet')
    expect(c.titleMsg.key).toBe('desktop.autotune.reason.level.up')
    expect(c.titleMsg.params?.db).toBeCloseTo(c.to - c.from, 6)
    expect(c.changeMsg.key).toBe('desktop.advice.change.db')
    expect(c.effect).toMatchObject({ metric: 'speechDb', before: r.before.speechDb, after: r.after.speechDb })
    expect(Math.abs(r.after.speechDb - TARGET_SPEECH_DB)).toBeLessThanOrEqual(1)
    expect(r.after.clipped).toBe(0)
    expect(r.after.peakDb).toBeLessThan(PEAK_WARN_DB)
    expect(r.after.score.total).toBeLessThan(r.before.score.total)
    expect(r.unmet).toEqual([])
  }, TIMEOUT)

  it('stops under the peak ceiling and says the rest is out of reach', async () => {
    // only a make-up gain (no threshold or ratio to tune): the level can rise until the loudest moments reach the ceiling
    const { result: r } = await run({ speechDb: -30, phraseDb: [0, 0, 0, 10] }, [eq(), { ...comp(0), values: { wetDb: 0 } }])
    expect(r.after.peakDb).toBeLessThan(PEAK_WARN_DB)
    expect(r.after.clipped).toBe(0)
    expect(r.after.speechDb).toBeGreaterThan(r.before.speechDb + 3)
    expect(unmetKeys(r)).toContain('level.peaks')
  }, TIMEOUT)

  it('without a compressor nothing sets the level: unmet, no change', async () => {
    const { result: r } = await run({ speechDb: -36 }, [gate({ thresholdDb: -60 }), eq()])
    expect(r.changes).toEqual([])
    expect(unmetKeys(r)).toContain('level.noToolQuiet')
  }, TIMEOUT)

  it('a level move that harms what comes after is held, and the result says so (not "Wet as high as it goes")', async () => {
    // an effect after the compressor that cuts the sound once it gets louder (as a level-dependent plugin might)
    const post = (x: Float32Array, live: readonly ChainSlot[]): void => {
      if ((live.find((sl) => sl.kind === 'reacomp')?.values.wetDb ?? 0) > 1) x.fill(0, 0, Math.round(x.length * 0.3))
    }
    const { result: r } = await run({ speechDb: -30 }, [eq(), comp(0)], {}, {}, { post })
    expect(r.changes).toEqual([])
    expect(unmetKeys(r)).toContain('level.held')
    expect(unmetKeys(r)).not.toContain('level.capQuiet')
  }, TIMEOUT)
})

describe('tune: already good', () => {
  it('changes nothing, uses one render and reports nothing unmet', async () => {
    const { result: r, calls } = await run({}, fullChain(GOOD_WET))
    expect(r.changes).toEqual([])
    expect(r.unmet).toEqual([])
    expect(r.renders).toBe(1)
    expect(calls).toBe(1)
    expect(r.after).toEqual(r.before)
    expect(r.before.score.total).toBe(0)
  }, TIMEOUT)
})

describe('tune: tone', () => {
  it('boomy take + "boomy": cuts the low bands, measures less boom, does not worsen the other bands', async () => {
    const { result: r } = await run({ tone: [0, 7, 4] }, fullChain(GOOD_WET), { bothers: ['boomy'] })
    expect(r.before.tone[1]).toBeGreaterThan(6)
    const eqChanges = r.changes.filter((c) => c.stage === 'tone')
    expect(eqChanges.length).toBeGreaterThan(0)
    const lowShelf = eqChanges.find((c) => c.key === 'band1.gainDb')
    expect(lowShelf?.to).toBeLessThan(0)
    expect(lowShelf?.titleMsg.key).toBe('desktop.autotune.reason.tone.high.boom')
    expect(lowShelf?.effect).toMatchObject({ metric: 'tone', band: 1 })
    expect(lowShelf?.effect.after).toBeLessThan((lowShelf?.effect.before ?? 0) - 2)
    // medium: no band moves more than 4 dB
    for (const c of eqChanges) expect(Math.abs(c.to - c.from)).toBeLessThanOrEqual(4)
    expect(r.after.tone[1]).toBeLessThan(r.before.tone[1] - 2)
    expect(r.after.tone[2]).toBeLessThan(r.before.tone[2] - 2)
    const t = targetsOf(goalsOf({ bothers: ['boomy'] }))
    const before = toneExcess(r.before.tone, t)
    const after = toneExcess(r.after.tone, t)
    for (let b = 3; b <= 8; b++) expect(after[b], `band ${b}`).toBeLessThanOrEqual(before[b] + 1)
    expect(r.after.score.tone).toBeLessThan(r.before.score.tone)
    // the level the cut cost came back
    expect(Math.abs(r.after.speechDb - TARGET_SPEECH_DB)).toBeLessThanOrEqual(1.01)
  }, TIMEOUT)

  it('a stronger amount cuts further', async () => {
    const medium = await run({ tone: [0, 7, 4] }, fullChain(GOOD_WET), { bothers: ['boomy'] })
    const strong = await run({ tone: [0, 7, 4] }, fullChain(GOOD_WET), { bothers: ['boomy'], amount: 'strong' })
    const light = await run({ tone: [0, 7, 4] }, fullChain(GOOD_WET), { bothers: ['boomy'], amount: 'light' })
    expect(strong.result.after.tone[1]).toBeLessThan(medium.result.after.tone[1] - 0.5)
    expect(light.result.after.tone[1]).toBeGreaterThan(medium.result.after.tone[1] + 0.5)
    for (const c of light.result.changes.filter((x) => x.stage === 'tone')) expect(Math.abs(c.to - c.from)).toBeLessThanOrEqual(2)
  }, TIMEOUT)

  it('a deep low-cut does not read as every other band being too loud: no across-the-board cuts', async () => {
    const { result: r } = await run({ tone: [-25, -20, -7] }, fullChain(GOOD_WET))
    // the robust level-match leaves the healthy bands at 0 (the plain mean would put them near +4)
    for (let b = 3; b <= 7; b++) expect(Math.abs(r.before.tone[b]), `band ${b}`).toBeLessThan(0.5)
    expect(r.before.tone[1]).toBeLessThan(-15)
    const eqChanges = r.changes.filter((c) => c.stage === 'tone')
    // nothing is cut, and the presence band and the high shelf are not touched at all
    for (const c of eqChanges) expect(c.to, c.key).toBeGreaterThan(c.from)
    expect(eqChanges.map((c) => c.key)).not.toContain('band4.gainDb')
    expect(eqChanges.map((c) => c.key)).not.toContain('band5.gainDb')
    for (let b = 3; b <= 8; b++) expect(Math.abs(r.after.tone[b]), `band ${b}`).toBeLessThanOrEqual(4)
    // the missing bass is beyond what a shelf may add: reported, not forced
    expect(unmetKeys(r)).toContain('tone.limitLow')
  }, TIMEOUT)

  it('chain without an EQ: unmet "add ReaEQ", tone untouched', async () => {
    const { result: r } = await run({ tone: [0, 7, 4] }, [gate({ thresholdDb: -60 }), comp(GOOD_WET)], { bothers: ['boomy'] })
    expect(r.changes.filter((c) => c.stage === 'tone')).toEqual([])
    expect(unmetKeys(r)).toContain('tone.noEq')
    expect(r.after.tone[1]).toBeCloseTo(r.before.tone[1], 3)
  }, TIMEOUT)

  it('sharp S: only bands that really move 5–10 kHz are used, presence is not sacrificed, the rest is reported', async () => {
    const { result: r } = await run({ tone: [0, 0, 0, 0, 0, 0, 0, 6, 2] }, fullChain(GOOD_WET), { bothers: ['sharpS'] })
    expect(r.after.tone[7]).toBeLessThan(r.before.tone[7] - 1)
    expect(r.after.tone[6]).toBeGreaterThanOrEqual(-4)
    for (const c of r.changes.filter((x) => x.stage === 'tone')) expect(['band4.gainDb', 'band5.gainDb']).toContain(c.key)
    expect(unmetKeys(r)).toContain('tone.sharpS')
  }, TIMEOUT)

  it('the style is the target: a warm goal leaves a warm take alone and a natural goal trims it', async () => {
    const warmTake = { tone: [0, 6, 5, 0, 1, 0, -1, -1, -1] }
    const asWarm = await run(warmTake, fullChain(GOOD_WET), { style: 'warm' })
    const asNatural = await run(warmTake, fullChain(GOOD_WET), { style: 'natural' })
    expect(asWarm.result.changes.filter((c) => c.stage === 'tone')).toEqual([])
    expect(asNatural.result.changes.some((c) => c.stage === 'tone' && c.to < c.from)).toBe(true)
  }, TIMEOUT)
})

describe('tune: a change that makes things worse is reverted', () => {
  it('EQ bands that do the opposite of their setting are not kept', async () => {
    // the two low bands boost when asked to cut
    const { result: r } = await run({ tone: [0, 7, 4] }, fullChain(GOOD_WET), { bothers: ['boomy'] }, {}, { eqGain: (_s, n, g) => (n <= 2 ? -g : g) })
    expect(r.changes.map((c) => c.key)).not.toContain('band1.gainDb')
    expect(r.changes.map((c) => c.key)).not.toContain('band2.gainDb')
    expect(r.log.some((l) => l.stage === 'tone' && l.event === 'revert')).toBe(true)
    expect(r.after.tone[1]).toBeGreaterThan(r.before.tone[1] - 0.5)
    expect(r.after.score.total).toBeLessThanOrEqual(r.before.score.total)
    expect(unmetKeys(r)).toContain('tone.limitHigh')
  }, TIMEOUT)

  it('a noise-removal step that turns pauses into dead silence is taken back and a smaller one kept', async () => {
    // the fake remover zeroes pauses from strength 80: 60 → 80 is rejected, 60 → 70 kept
    const { result: r } = await run({ noiseDb: -45 }, [noiseRemoval(60), eq(), comp(GOOD_WET)], { bothers: ['roomNoise'] })
    const c = r.changes.find((x) => x.key === 'strength')
    expect(c?.to).toBe(70)
    expect(r.log.some((l) => l.stage === 'noise' && l.event === 'revert' && l.text.includes('damage'))).toBe(true)
    expect(r.after.deadSilence).toBeLessThan(0.05)
  }, TIMEOUT)

  it('a make-up gain that only clips is not kept', async () => {
    // a broken last stage: every sample above 0.2 is pushed to full scale once Wet goes over 3 dB
    const post = (x: Float32Array, chain: readonly ChainSlot[]): void => {
      if ((chain.find((s) => s.kind === 'reacomp')?.values.wetDb ?? 0) <= 3) return
      for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > 0.2) x[i] = Math.sign(x[i])
    }
    const { result: r } = await run({ speechDb: -34 }, fullChain(0), {}, {}, { post })
    expect(r.changes).toEqual([])
    expect(r.after).toEqual(r.before)
    expect(r.log.some((l) => l.stage === 'level' && l.event === 'revert')).toBe(true)
  }, TIMEOUT)
})

describe('tune: noise & gate', () => {
  it('noisy pauses + "room noise": pause noise goes down without dead silence or cut words', async () => {
    const { result: r } = await run({ noiseDb: -50 }, fullChain(GOOD_WET), { bothers: ['roomNoise'] })
    expect(r.before.snrDb).toBeLessThan(35)
    const c = r.changes.find((x) => x.key === 'strength')
    expect(c?.to).toBeGreaterThan(c?.from ?? Infinity)
    expect(c?.stage).toBe('noise')
    expect(c?.effect.metric).toBe('snrDb')
    expect(r.after.snrDb).toBeGreaterThan(r.before.snrDb + 6)
    expect(r.after.pauseDb).toBeLessThan(r.before.pauseDb - 6)
    expect(r.after.deadSilence).toBeLessThan(0.05)
    expect(r.after.wordLossDb).toBeLessThan(2)
    expect(r.after.score.noise).toBeLessThan(r.before.score.noise)
  }, TIMEOUT)

  it('nothing to remove the noise with: unmet, no change', async () => {
    const { result: r } = await run({ noiseDb: -45 }, [eq(), comp(GOOD_WET)], { bothers: ['roomNoise'] })
    expect(r.changes.filter((c) => c.stage === 'noise')).toEqual([])
    expect(unmetKeys(r)).toContain('noise.noTool')
  }, TIMEOUT)

  it('dead-silent pauses from the noise remover: one step lighter, unless the goals ask for as much removal as possible', async () => {
    const chain = (): ChainSlot[] => [noiseRemoval(85), gate({ thresholdDb: -60 }), eq(), comp(GOOD_WET)]
    const natural = await run({ noiseDb: -60 }, chain())
    expect(natural.result.before.deadSilence).toBeGreaterThan(0.2)
    const c = natural.result.changes.find((x) => x.key === 'strength')
    expect(c).toMatchObject({ from: 85, to: 65, reason: 'deadSilence' })
    expect(c?.effect.metric).toBe('deadSilence')
    expect(natural.result.after.deadSilence).toBeLessThan(0.05)

    const max = await run({ noiseDb: -60 }, chain(), { bothers: ['roomNoise'], amount: 'strong' })
    expect(max.result.changes.find((x) => x.key === 'strength')).toBeUndefined()
    expect(max.result.after.score.damage).toBe(0)
  }, TIMEOUT)

  it('a hard gate leaving dead silence gets the soft Dry', async () => {
    const { result: r } = await run({ noiseDb: -60 }, [gate({ thresholdDb: -45, dryDb: -100 }), eq(), comp(GOOD_WET)])
    expect(r.changes.find((c) => c.key === 'dryDb')).toMatchObject({ from: -100, to: -20, stage: 'noise' })
    expect(r.after.deadSilence).toBeLessThan(0.05)
  }, TIMEOUT)

  it('a doubled gate over noisy pauses gets Dry −20', async () => {
    const { result: r } = await run({ noiseDb: -48 }, [gate({ thresholdDb: -40, dryDb: 0 }), eq(), comp(GOOD_WET)])
    expect(r.changes.find((c) => c.key === 'dryDb')).toMatchObject({ from: 0, to: -20, reason: 'gateDoubled' })
    expect(r.after.snrDb).toBeGreaterThan(r.before.snrDb + 5)
    expect(Math.abs(r.after.speechDb - TARGET_SPEECH_DB)).toBeLessThanOrEqual(1.01)
  }, TIMEOUT)

  // the noisy-room chain (… → ReaComp → ReaGate): 12 dB of make-up before the gate, whose −60 dB never closes
  const behindComp = (): ChainSlot[] => [eq(), comp(12), { ...gate({ thresholdDb: -60, dryDb: 0 }), index: 4 }]
  const quietTake = { speechDb: -33, phraseDb: [0, -6, -2, -8] }

  it('a doubled gate behind a compressor is placed on what it receives, and follows the make-up gain', async () => {
    const { result: r } = await run({ ...quietTake, noiseDb: -55 }, behindComp())
    expect(r.changes.find((c) => c.key === 'dryDb')).toMatchObject({ from: 0, to: -20, reason: 'gateDoubled' })
    const thr = r.changes.find((c) => c.key === 'thresholdDb')
    // the raw take's room (−55) + 6 would be −49: under what the gate receives behind 12 dB of make-up
    expect(thr?.to).toBeGreaterThan(-40)
    expect(thr?.titleMsg).toEqual({ key: 'desktop.autotune.reason.noise.threshold', params: { to: thr?.to } })
    expect(r.after.snrDb).toBeGreaterThan(r.before.snrDb + 10)
    expect(r.after.wordLossDb).toBeLessThan(2)
    expect(Math.abs(r.after.speechDb - TARGET_SPEECH_DB)).toBeLessThanOrEqual(1.01)
    // the final trim moved the Wet and the threshold together
    const trim = r.log.find((l) => l.stage === 'trim' && l.event === 'keep')
    expect(trim?.text).toMatch(/reacomp\[3\]\.wetDb → [-\d.]+, reagate\[4\]\.thresholdDb → /)
  }, TIMEOUT)

  it('a gate behind a compressor that would close on the quiet phrases is left as it was', async () => {
    const { result: r } = await run({ ...quietTake, noiseDb: -50 }, behindComp())
    expect(r.changes.find((c) => c.slot === 4)).toBeUndefined()
    expect(r.log.some((l) => l.stage === 'noise' && l.event === 'revert' && /reagate\[4\]\.thresholdDb/.test(l.text))).toBe(true)
    expect(r.after.spreadDb).toBeLessThan(r.before.spreadDb + 1)
  }, TIMEOUT)
})

describe('tune: the voice does not come out', () => {
  it('a gate that never opens is repaired first, then the level', async () => {
    const { result: r } = await run({ noiseDb: -60 }, [gate({ thresholdDb: 0, dryDb: -100 }), eq(), comp(0)])
    expect(r.before.speechDb).toBe(-100)
    expect(r.before.tone.every(Number.isNaN)).toBe(true)
    // nothing is judged on a render without a voice except getting it back
    expect(r.changes[0]).toMatchObject({ key: 'dryDb', to: -20, stage: 'noise' })
    expect(r.changes.some((c) => c.key === 'wetDb' && c.to > c.from)).toBe(true)
    expect(r.after.speechDb).toBeGreaterThan(-40)
    expect(r.after.deadSilence).toBeLessThan(0.05)
    expect(unmetKeys(r)).not.toContain('silent')
  }, TIMEOUT)

  it('nothing in reach cuts it: unmet, no change, no wasted renders', async () => {
    const { result: r, calls } = await run({}, fullChain(GOOD_WET), { bothers: ['boomy'] }, {}, { post: (x) => x.fill(0) })
    expect(r.changes).toEqual([])
    expect(unmetKeys(r)).toEqual(['silent'])
    expect(calls).toBeLessThanOrEqual(3)
  }, TIMEOUT)
})

describe('tune: compression', () => {
  it('uneven volume: the spread narrows and the level is trimmed back', async () => {
    const chain = [eq(), { ...comp(6), values: { thresholdDb: -12, ratio: 1.5, attackMs: 5, releaseMs: 100, wetDb: 6 } }]
    const { result: r } = await run({ speechDb: -18, phraseDb: [0, -12, -3, -14] }, chain, { bothers: ['unevenVolume'] })
    expect(r.before.spreadDb).toBeGreaterThan(8)
    const stages = r.changes.filter((c) => c.stage === 'compression').map((c) => c.key)
    expect(stages).toEqual(expect.arrayContaining(['ratio', 'thresholdDb']))
    expect(r.after.spreadDb).toBeLessThan(r.before.spreadDb - 1)
    expect(r.changes.find((c) => c.key === 'ratio')?.effect).toMatchObject({ metric: 'spreadDb', after: r.after.spreadDb })
    expect(Math.abs(r.after.speechDb - TARGET_SPEECH_DB)).toBeLessThanOrEqual(1.01)
    expect(r.after.clipped).toBe(0)
  }, TIMEOUT)

  it('no compressor: unmet', async () => {
    const { result: r } = await run({ speechDb: -21, phraseDb: [0, -12, -3, -14] }, [eq()], { bothers: ['unevenVolume'] })
    expect(unmetKeys(r)).toContain('spread.noComp')
  }, TIMEOUT)
})

describe('tune: budget, progress, determinism', () => {
  const messy = { speechDb: -34, noiseDb: -48, tone: [0, 7, 4, 0, 0, 0, 0, 5, 0], phraseDb: [0, -10, -2, -12] }
  const messyGoals: Partial<TuneGoals> = { bothers: ['boomy', 'roomNoise', 'unevenVolume', 'sharpS'], amount: 'strong' }

  it('never renders more than the budget, counts every render and reports progress', async () => {
    const seen: [TuneStage, number, number][] = []
    const { result: r, calls } = await run(messy, fullChain(), messyGoals, { onProgress: (stage, pass, of) => seen.push([stage, pass, of]) })
    expect(r.renders).toBeLessThanOrEqual(DEFAULT_MAX_RENDERS)
    expect(r.renders).toBe(calls)
    expect(seen.map((s) => s[1])).toEqual(Array.from({ length: calls }, (_, i) => i + 1))
    expect(seen[0][0]).toBe('baseline')
    expect(seen.every((s) => s[2] === DEFAULT_MAX_RENDERS)).toBe(true)
    expect(r.changes.length).toBeGreaterThan(2)
    expect(r.after.score.total).toBeLessThan(r.before.score.total)
  }, TIMEOUT)

  it('a small budget is respected and what was skipped is reported', async () => {
    const { result: r, calls } = await run(messy, fullChain(), messyGoals, { maxRenders: 3 })
    expect(calls).toBeLessThanOrEqual(3)
    expect(r.renders).toBe(calls)
    expect(unmetKeys(r)).toContain('budget')
    // whatever was kept still beats the start
    expect(r.after.score.total).toBeLessThanOrEqual(r.before.score.total)
  }, TIMEOUT)

  it('the final render is the chain with exactly the kept changes', async () => {
    const x = testTake(messy)
    const chain = fullChain()
    const { render } = fakeRenderer(x, chain)
    const r = await tune({ take: x, chain, render, goals: goalsOf(messyGoals) })
    const again = await render(r.changes)
    expect(Array.from(r.processed.subarray(0, 4000))).toEqual(Array.from(again.subarray(0, 4000)))
    expect(r.processed.length).toBe(x.length)
    for (const c of r.changes) expect(c.from).toBe(chain.find((s) => s.index === c.slot)?.values[c.key])
  }, TIMEOUT)

  it('same inputs, same result', async () => {
    const a = await run(messy, fullChain(), messyGoals)
    const b = await run(messy, fullChain(), messyGoals)
    expect(b.result.changes).toEqual(a.result.changes)
    expect(b.result.before).toEqual(a.result.before)
    expect(b.result.after).toEqual(a.result.after)
    expect(b.result.unmet).toEqual(a.result.unmet)
    expect(b.result.log).toEqual(a.result.log)
    expect(b.result.renders).toBe(a.result.renders)
    expect(b.result.processed).toEqual(a.result.processed)
  }, TIMEOUT)

  it('a take without speech: no changes, one render, unmet', async () => {
    const x = new Float32Array(48000 * 6)
    const { render, calls } = fakeRenderer(x, fullChain())
    const r = await tune({ take: x, chain: fullChain(), render, goals: goalsOf() })
    expect(r.changes).toEqual([])
    expect(calls.length).toBe(1)
    expect(unmetKeys(r)).toEqual(['notEnoughSpeech'])
  }, TIMEOUT)

  it('a render of the wrong length is an error', async () => {
    const x = testTake({})
    await expect(tune({ take: x, chain: fullChain(), render: () => Promise.resolve(new Float32Array(100)), goals: goalsOf() })).rejects.toThrow(/samples/)
  }, TIMEOUT)
})

describe('retune', () => {
  it('"too processed": one amount lighter, every non-level change starts halfway back and ends inside the lighter caps', async () => {
    const first = await run({ tone: [0, 7, 4] }, fullChain(GOOD_WET), { bothers: ['boomy'] })
    const resume = retune(first.result, 'tooProcessed')
    expect(resume.goals.amount).toBe('light')
    expect(resume.limit).toBe(1)
    expect(resume.startRender).toBeUndefined()
    for (const c of resume.start ?? []) {
      const was = first.result.changes.find((p) => p.slot === c.slot && p.key === c.key)
      if (c.stage === 'tone') expect(c.to - c.from).toBeCloseTo(((was?.to ?? 0) - (was?.from ?? 0)) / 2, 6)
      else expect(c.to).toBe(was?.to)
    }
    const second = await tune({ ...first.input, ...resume })
    const tone = second.changes.filter((c) => c.stage === 'tone')
    expect(tone.length).toBeGreaterThan(0)
    for (const c of tone) expect(Math.abs(c.to - c.from)).toBeLessThanOrEqual(2)
    expect(second.after.tone[1]).toBeGreaterThan(first.result.after.tone[1])
    expect(second.after.tone[1]).toBeLessThan(first.result.before.tone[1])
    expect(Math.abs(second.after.speechDb - TARGET_SPEECH_DB)).toBeLessThanOrEqual(1.01)

    // already on the lightest amount: the caps halve instead
    const third = retune(second, 'tooProcessed')
    expect(third.goals.amount).toBe('light')
    expect(third.limit).toBe(0.5)
    expect(targetsOf(third.goals, third.limit).caps.eqStepDb).toBe(1)
  }, TIMEOUT)

  it('more bothers: starts from the previous changes and render, adds the goal, pushes further when it was already one', async () => {
    // sibilance +2.5 dB is inside the normal tolerance, so the first run leaves it; picking "sharp S" makes it a goal
    const first = await run({ tone: [0, 7, 4, 0, 0, 0, 0, 2.5, 0] }, fullChain(GOOD_WET), { bothers: ['boomy'] })
    const resume = retune(first.result, ['sharpS'])
    expect(resume.goals.bothers).toEqual(['boomy', 'sharpS'])
    expect(resume.goals.amount).toBe('medium')
    expect(resume.start).toBe(first.result.changes)
    expect(resume.startRender).toBe(first.result.processed)
    const x = first.input.take
    const { render, calls } = fakeRenderer(x, first.input.chain)
    const second = await tune({ take: x, chain: first.input.chain, render, ...resume })
    // the baseline is rendered again, the start state is not
    expect(calls[0]).toEqual([])
    expect(calls.slice(1).every((c) => c.length > 0)).toBe(true)
    expect(second.before).toEqual({ ...first.result.before, score: second.before.score })
    expect(second.after.tone[7]).toBeLessThan(first.result.after.tone[7] - 0.5)
    expect(second.after.tone[1]).toBeLessThanOrEqual(first.result.after.tone[1] + 0.5)
    expect(second.changes.find((c) => c.key === 'band1.gainDb')?.to).toBe(first.result.changes.find((c) => c.key === 'band1.gainDb')?.to)

    const again = retune(first.result, ['boomy'])
    expect(again.goals.amount).toBe('strong')
    expect(again.goals.bothers).toEqual(['boomy'])
  }, TIMEOUT)

  it('a start that no longer beats the untouched chain is dropped', async () => {
    const first = await run({ tone: [0, 7, 4] }, fullChain(GOOD_WET), { bothers: ['boomy'] })
    // the same changes on a take that is not boomy at all: they only do harm there
    const x = testTake({ speechDb: -21, noiseDb: -80, tone: [0, -3, -3] })
    const { render } = fakeRenderer(x, first.input.chain)
    const r = await tune({ take: x, chain: first.input.chain, render, goals: goalsOf(), start: first.result.changes })
    expect(r.log.some((l) => l.stage === 'baseline' && l.event === 'revert')).toBe(true)
    expect(r.changes.filter((c) => c.stage === 'tone' && c.to < c.from)).toEqual([])
  }, TIMEOUT)
})
