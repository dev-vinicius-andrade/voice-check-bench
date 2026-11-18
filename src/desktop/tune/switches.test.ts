// @vitest-environment node
// Switch candidates (ReaFIR off, Noise Removal on), a band's frequency / width moves, complaints the measurement
// contradicts, and that all of it stays deterministic and inside the budget and the caps.
import { describe, expect, it } from 'vitest'
import { biquad } from '../../audio/eqCurve'
import { canonicalName } from '../../wavelink/plugins'
import { comp, eq, gate, noiseRemoval } from '../advice/testFixtures'
import type { ChainSlot } from '../advice/types'
import { EqCurves, eqHandles, planShaped, planTone, reshape, sameShape, SHAPE_BW, shapeVariants } from './eqModel'
import { fakeRenderer, type FakeOptions } from './fakeRenderer'
import { cutOf, fineLevels, measure, prepareTake } from './measure'
import { peakSpots } from './peakStage'
import { metricRows } from '../autotune/results'
import { cutsSpeech, pumps, scoreOf, toneOf, worseBecause } from './score'
import { DEFAULT_MAX_RENDERS, STAGE_RENDERS } from './session'
import { targetsOf } from './targets'
import { testTake, type TestTakeOptions } from './testTake'
import { retune, tune } from './tune'
import { engineChanges, valueChanges, type TuneGoals, type TuneInput, type TuneResult } from './types'

const TIMEOUT = 60_000
const GOOD_WET = 8.5
const goalsOf = (g: Partial<TuneGoals> = {}): TuneGoals => ({ use: 'streaming', style: 'natural', bothers: [], amount: 'medium', ...g })
const reafir = (on = true): ChainSlot => ({ index: 9, kind: 'reafir', name: 'ReaFir (ReaPlugs Edition)', on, values: {} })
/** ReaFIR → (Noise Removal, switched off) → ReaEQ → ReaComp, in chain order. */
const firChain = (nr = false): ChainSlot[] => [{ ...reafir(), index: -1 }, ...(nr ? [noiseRemoval(44, false)] : []), eq(), comp(GOOD_WET)]

async function run(take: Partial<TestTakeOptions>, chain: ChainSlot[], goals: Partial<TuneGoals> = {}, extra: Partial<TuneInput> = {}, fake: FakeOptions = {}) {
  const x = testTake({ speechDb: -21, noiseDb: -80, ...take })
  const { render, calls } = fakeRenderer(x, chain, fake)
  const input: TuneInput = { take: x, chain, render, goals: goalsOf(goals), ...extra }
  const result = await tune(input)
  return { result, calls, input, render, x }
}

const unmetKeys = (r: TuneResult): string[] => r.unmet.map((m) => m.key.replace('desktop.autotune.unmet.', ''))
const switches = (r: TuneResult) => r.changes.filter((c) => c.kind === 'switch')
const sameAudio = (a: Float32Array, b: Float32Array): boolean => a.length === b.length && a.every((v, i) => v === b[i])

/** A noise profile that does not fit: every 10 ms block under `db` dBFS is cut out (quiet words with the room). */
const eatsQuiet = (db: number) => (x: Float32Array, sr: number): void => {
  const w = Math.round(0.01 * sr)
  for (let s = 0; s < x.length; s += w) {
    let e = 0
    for (let i = s; i < Math.min(x.length, s + w); i++) e += x[i] * x[i]
    if (10 * Math.log10(e / w + 1e-20) < db) x.fill(0, s, Math.min(x.length, s + w))
  }
}
/** A ReaFIR that only takes the room down: blocks under `db` dBFS lose 20 dB, the voice is untouched. */
const onlyRoom = (db: number) => (x: Float32Array, sr: number): void => {
  const w = Math.round(0.01 * sr)
  for (let s = 0; s < x.length; s += w) {
    let e = 0
    for (let i = s; i < Math.min(x.length, s + w); i++) e += x[i] * x[i]
    if (10 * Math.log10(e / w + 1e-20) < db) for (let i = s; i < Math.min(x.length, s + w); i++) x[i] *= 0.1
  }
}

describe('tune: ReaFIR off as a candidate', () => {
  it('a ReaFIR that cuts the quiet words is switched off before anything else, and the result says why', async () => {
    const { result: r, calls } = await run({ phraseDb: [0, 0, -12] }, firChain(), {}, {}, { reafir: eatsQuiet(-30) })
    expect(r.before.wordLossDb).toBeGreaterThan(5)
    expect(r.after.wordLossDb).toBeLessThanOrEqual(2)
    const [off] = switches(r)
    expect(off).toMatchObject({ kind: 'switch', on: false, slot: -1, stage: 'baseline' })
    expect(off.titleMsg.key).toBe('desktop.autotune.reason.switch.reafirDamage')
    expect(off.changeMsg).toEqual({ key: 'desktop.advice.change.off', params: { plugin: canonicalName(reafir().name) } })
    expect(off.effect).toMatchObject({ metric: 'wordLossDb', before: r.before.wordLossDb, after: r.after.wordLossDb })
    expect('from' in off || 'to' in off).toBe(false)
    // it was the second render: the chain as it is, then the chain without it
    expect(calls[1]).toMatchObject([{ kind: 'switch', slot: -1, on: false }])
    expect(unmetKeys(r)).not.toContain('chopped')
  }, TIMEOUT)

  it('a ReaFIR that hollows out the lows of a healthy voice is switched off: both ends were rendered and the one without it measured better', async () => {
    const { result: r, render } = await run({}, firChain())
    // with it the boom is gone and no EQ band may add that much
    expect(r.before.tone[1]).toBeLessThan(-8)
    expect(switches(r)).toMatchObject([{ kind: 'switch', on: false, stage: 'noise' }])
    expect(switches(r)[0].titleMsg).toEqual({ key: 'desktop.autotune.reason.switch.reafirTone', params: { lo: 80, hi: 160 } })
    expect(Math.abs(r.after.tone[1])).toBeLessThan(3)
    expect(r.after.score.tone).toBeLessThan(r.before.score.tone - 5)
    expect(r.log.some((l) => l.event === 'keep' && /reafir\[-1\] off, with the tone tuned for it/.test(l.text))).toBe(true)
    // the EQ moves tried with ReaFIR on are not part of the result
    expect(sameAudio(await render(engineChanges(r.changes)), r.processed)).toBe(true)
  }, TIMEOUT)

  it('a ReaFIR that only takes the room down stays on: without it the tone is no better and the room is louder', async () => {
    // a voice that is thin by itself: the EQ cannot repair it with or without ReaFIR
    const { result: r, calls, render } = await run({ noiseDb: -45, tone: [0, -20, -9] }, firChain(), {}, {}, { reafir: onlyRoom(-38) })
    expect(calls.some((c) => c.some((x) => x.kind === 'switch'))).toBe(true)
    expect(switches(r)).toEqual([])
    expect(r.log.some((l) => l.event === 'revert' && /reafir\[-1\] off, with the tone tuned for it/.test(l.text))).toBe(true)
    expect(r.after.snrDb).toBeGreaterThanOrEqual(r.before.snrDb - 0.5)
    // back on the first branch exactly: its changes render to the result's audio
    expect(sameAudio(await render(engineChanges(r.changes)), r.processed)).toBe(true)
    // nobody complained about the thin lows and nothing there is theirs to fix: no line about them
    expect(unmetKeys(r).filter((k) => k.startsWith('tone.')).length).toBeLessThanOrEqual(3)
  }, TIMEOUT)

  it('a tone the EQ reaches with ReaFIR on never asks the question: no switch is rendered', async () => {
    const { result: r, calls } = await run({ tone: [0, 0, 5] }, firChain(), {}, {}, { reafir: onlyRoom(-60) })
    expect(calls.some((c) => c.some((x) => x.kind === 'switch'))).toBe(false)
    expect(r.after.score.tone).toBeLessThan(3)
  }, TIMEOUT)
})

describe('tune: Noise Removal on as a candidate', () => {
  const nrChain = (): ChainSlot[] => [noiseRemoval(44, false), eq(), comp(GOOD_WET)]

  it('a noisy room and a Noise Removal sitting switched off: on, at a strength counted from zero inside the amount cap', async () => {
    const { result: r } = await run({ noiseDb: -45 }, nrChain())
    expect(r.before.snrDb).toBeLessThan(27)
    expect(switches(r)).toMatchObject([{ kind: 'switch', on: true, slot: 0, stage: 'noise' }])
    expect(switches(r)[0].titleMsg.key).toBe('desktop.autotune.reason.switch.nrOn')
    expect(switches(r)[0].changeMsg.key).toBe('desktop.advice.change.on')
    const strength = valueChanges(r.changes).find((c) => c.key === 'strength')
    expect(strength?.from).toBe(44)
    expect(strength?.to).toBeGreaterThan(0)
    expect(strength?.to).toBeLessThanOrEqual(targetsOf(goalsOf()).caps.nrMax)
    expect(strength?.titleMsg.key).toMatch(/reason\.noise\.(onStrength|strength)$/)
    expect(r.after.snrDb).toBeGreaterThan(r.before.snrDb + 2)
    expect(r.after.deadSilence).toBeLessThan(0.05)
    expect(r.after.wordLossDb).toBeLessThanOrEqual(2)
  }, TIMEOUT)

  it('a remover that costs the voice its tone is switched back off after one try, and the result says the room is still there', async () => {
    // whenever it is on, 640 Hz–2.5 kHz loses 12 dB (the real one behind the compressor took 7)
    const dulls = (x: Float32Array, chain: readonly ChainSlot[]): void => {
      if (!chain.some((s) => s.kind === 'noiseRemoval' && s.on)) return
      const c = biquad({ type: 'Band', freq: 1250, gain: -12, bw: 2 }, 48000)
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0
      for (let i = 0; i < x.length; i++) {
        const y0 = (c.b0 * x[i] + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2) / c.a0
        x2 = x1
        x1 = x[i]
        y2 = y1
        y1 = y0
        x[i] = y0
      }
    }
    const { result: r, calls } = await run({ noiseDb: -50 }, nrChain(), {}, {}, { post: dulls })
    const tries = calls.filter((c) => c.some((x) => x.kind === 'switch' && x.on))
    // every strength inside the cap is tried once (lightest first), each dulls the voice: none kept, and not asked again later
    expect(tries.length).toBeGreaterThanOrEqual(2)
    expect(tries.length).toBeLessThanOrEqual(5)
    expect(switches(r)).toEqual([])
    expect(valueChanges(r.changes).some((c) => c.key === 'strength')).toBe(false)
    expect(unmetKeys(r)).toContain('noise.limit')
  }, TIMEOUT)

  it('a quiet room never switches it on', async () => {
    const { result: r, calls } = await run({ noiseDb: -70 }, nrChain())
    expect(calls.some((c) => c.some((x) => x.kind === 'switch'))).toBe(false)
    expect(switches(r)).toEqual([])
  }, TIMEOUT)
})

describe('tune: a band moves to where the voice needs it', () => {
  /** A hump at 160–320 Hz right next to a hole at 80–160 Hz (a close mic behind a low-cut). */
  const HUMP = { tone: [0, -8, 9] }

  it('a hump next to a hole: the cut is placed on the hump and narrowed, the hole is not deepened', async () => {
    const { result: r } = await run(HUMP, [eq(), comp(GOOD_WET)], { bothers: ['lacksClarity'] })
    expect(r.before.tone[2]).toBeGreaterThan(8)
    expect(r.after.tone[2]).toBeLessThan(r.before.tone[2] - 4)
    expect(r.after.tone[1]).toBeGreaterThan(r.before.tone[1] - 1.5)
    const band = r.changes.find((c) => c.changeMsg.key === 'desktop.autotune.change.band')
    expect(band?.kind).toBe('value')
    expect(band?.also?.length).toBeGreaterThan(0)
    expect(band?.titleMsg).toEqual({ key: 'desktop.autotune.reason.tone.shape.high', params: { lo: 160, hi: 320 } })
    const p = band?.changeMsg.params as Record<string, number>
    // within an octave of where it was, a sane width, a cut, inside the medium step
    expect(Math.abs(Math.log2(p.toHz / p.fromHz))).toBeLessThanOrEqual(1)
    expect(p.toOct).toBeGreaterThanOrEqual(SHAPE_BW[0])
    expect(p.toOct).toBeLessThanOrEqual(SHAPE_BW[1])
    expect(p.toDb).toBeLessThan(p.fromDb)
    expect(p.toDb).toBeGreaterThanOrEqual(-4)
    // every engine value of the band is there: the line's numbers are what gets set
    const flat = valueChanges(r.changes).filter((c) => c.slot === band?.slot && c.key.startsWith(`${(band as { key: string }).key.split('.')[0]}.`))
    expect(flat.find((c) => c.key.endsWith('.gainDb'))?.to ?? p.fromDb).toBe(p.toDb)
    expect(Math.round(flat.find((c) => c.key.endsWith('.freqHz'))?.to ?? p.fromHz)).toBe(p.toHz)
  }, TIMEOUT)

  it('gains alone could not: with the same budget a plan without shape moves leaves the hump higher', () => {
    const x = testTake({ speechDb: -21, noiseDb: -80, ...HUMP })
    const mask = prepareTake(x)
    if (!mask) throw new Error('no take')
    const t = targetsOf(goalsOf({ bothers: ['lacksClarity'] }))
    const home = eqHandles([eq()], t.caps.eqStepDb, () => false)
    const curves = new EqCurves(home, mask.cellHz, 48000)
    const cells = measure(mask, x).cells
    const start = home.map((h) => h.base)
    const ones = home.map(() => 1)
    const flat = planTone(curves, cells, start, ones, t, t.caps.eqTotalDb)
    const variants = (i: number, bands: readonly number[]) => shapeVariants(home[i], bands).map((v) => reshape(home[i], v.freqHz, v.bwOct, () => false))
    const shaped = planShaped(curves, cells, start, ones, t, t.caps.eqTotalDb, variants)
    const warmth = (c: EqCurves, g: readonly number[]): number => c.delta(start, g, ones, curves).slice(12, 18).reduce((s, v) => s + v, 0) / 6
    const boom = (c: EqCurves, g: readonly number[]): number => c.delta(start, g, ones, curves).slice(6, 12).reduce((s, v) => s + v, 0) / 6
    expect(warmth(shaped.curves, shaped.gains)).toBeLessThan(warmth(curves, flat) - 1.5)
    expect(boom(shaped.curves, shaped.gains)).toBeGreaterThan(-1.5)
    // caps: every band's whole curve within the step, all of them within the total, at most two shapes moved
    const moved = shaped.gains.map((g, i) => shaped.curves.movedDb(i, g))
    for (const m of moved) expect(m).toBeLessThanOrEqual(t.caps.eqStepDb + 1e-6)
    expect(moved.reduce((s, m) => s + m, 0)).toBeLessThanOrEqual(t.caps.eqTotalDb + 1e-6)
    const reshaped = shaped.curves.handles.filter((h) => !sameShape(h))
    expect(reshaped.length).toBeGreaterThan(0)
    expect(reshaped.length).toBeLessThanOrEqual(2)
    for (const h of reshaped) {
      expect(Math.abs(Math.log2(h.freqHz / h.baseFreqHz))).toBeLessThanOrEqual(1 + 1e-9)
      expect(h.type === 'Band' ? h.bwOct >= SHAPE_BW[0] && h.bwOct <= SHAPE_BW[1] : h.bwOct === h.baseBwOct).toBe(true)
    }
    // a shelf stays a shelf
    expect(shaped.curves.handles.map((h) => h.type)).toEqual(home.map((h) => h.type))
  })

  it('a moved band counts by how far its curve moved: light moves less than medium, and a take the gains fix moves no shape', async () => {
    const light = await run(HUMP, [eq(), comp(GOOD_WET)], { bothers: ['lacksClarity'], amount: 'light' })
    const medium = await run(HUMP, [eq(), comp(GOOD_WET)], { bothers: ['lacksClarity'] })
    for (const c of valueChanges(light.result.changes).filter((x) => x.key.endsWith('.gainDb'))) expect(Math.abs(c.to - c.from)).toBeLessThanOrEqual(2)
    expect(light.result.after.tone[2]).toBeGreaterThan(medium.result.after.tone[2] + 0.5)
    const easy = await run({ tone: [0, 0, 4] }, [eq(), comp(GOOD_WET)])
    expect(valueChanges(easy.result.changes).filter((c) => /\.(freqHz|bwOct)$/.test(c.key))).toEqual([])
  }, TIMEOUT)

  it('"too processed" brings a moved band halfway back as a whole and the retune still renders what it reports', async () => {
    const first = await run(HUMP, [eq(), comp(GOOD_WET)], { bothers: ['lacksClarity'] })
    const resume = retune(first.result, 'tooProcessed')
    const second = await tune({ ...first.input, ...resume })
    expect(second.after.tone[2]).toBeGreaterThan(first.result.after.tone[2])
    expect(sameAudio(await first.render(engineChanges(second.changes)), second.processed)).toBe(true)
  }, TIMEOUT)
})

describe('tune: a complaint the measurement contradicts', () => {
  it('"lacks presence" on a voice whose presence measures high: not lifted, and the result names what hides it', async () => {
    const { result: r } = await run({ tone: [0, 0, 9, 0, 0, 0, 4] }, [eq(), comp(GOOD_WET)], { bothers: ['lacksPresence'], amount: 'light' })
    const said = r.unmet.find((m) => m.key === 'desktop.autotune.unmet.tone.hidden')
    expect(said?.params).toMatchObject({ lo: 2500, hi: 5000, maskLo: 160, maskHi: 320 })
    expect(Number(said?.params?.db)).toBeGreaterThan(1)
    expect(Number(said?.params?.maskDb)).toBeGreaterThanOrEqual(4)
    // the 3.5 kHz band is not pushed up against the measurement's word, and nothing says only "still above target" there
    expect(valueChanges(r.changes).some((c) => c.key === 'band4.gainDb' && c.to > c.from)).toBe(false)
    expect(r.unmet.some((m) => m.key.endsWith('tone.limitHigh') && m.params?.lo === 2500)).toBe(false)
  }, TIMEOUT)

  it('nothing loud under it: it says the band already measures high; "boomy" on a thin voice says it already measures low', async () => {
    const high = await run({ tone: [0, 0, 0, 0, 0, 0, 3] }, [eq(), comp(GOOD_WET)], { bothers: ['lacksPresence'] })
    expect(high.result.unmet.find((m) => m.key.endsWith('tone.alreadyHigh'))?.params).toMatchObject({ lo: 2500, hi: 5000 })
    expect(high.result.changes).toEqual([])
    const low = await run({ tone: [0, -5, -4] }, [eq(), comp(GOOD_WET)], { bothers: ['boomy'] })
    expect(low.result.unmet.filter((m) => m.key.endsWith('tone.alreadyLow')).map((m) => m.params?.lo)).toEqual([80])
    // boomy never lifts the lows, so nothing was done there: that is said, not hidden
    expect(valueChanges(low.result.changes).filter((c) => /^band[12]\.gainDb$/.test(c.key))).toEqual([])
  }, TIMEOUT)

  it('a complaint the measurement agrees with says nothing of the kind', async () => {
    const { result: r } = await run({ tone: [0, 0, 0, 0, 0, 0, -5] }, [eq(), comp(GOOD_WET)], { bothers: ['lacksPresence'] })
    expect(r.unmet.some((m) => /tone\.(hidden|already)/.test(m.key))).toBe(false)
    expect(r.after.tone[6]).toBeGreaterThan(r.before.tone[6] + 2)
  }, TIMEOUT)
})

describe('tune: switches and shapes stay deterministic and inside the budget', () => {
  const noisyFir = { noiseDb: -47, phraseDb: [0, -8], tone: [0, 0, 8, 0, 0, 0, 4] }

  it('same inputs, same result', async () => {
    const a = await run(noisyFir, firChain(true), { bothers: ['lacksClarity', 'roomNoise'] })
    const b = await run(noisyFir, firChain(true), { bothers: ['lacksClarity', 'roomNoise'] })
    expect(b.result.changes).toEqual(a.result.changes)
    expect(b.result.renders).toBe(a.result.renders)
    expect(b.result.unmet).toEqual(a.result.unmet)
    expect(sameAudio(a.result.processed, b.result.processed)).toBe(true)
  }, TIMEOUT)

  it('never more renders than the budget, each stage inside its share, and the result is what its changes render', async () => {
    expect(1 + Object.values(STAGE_RENDERS).reduce((s, v) => s + v, 0)).toBeLessThanOrEqual(DEFAULT_MAX_RENDERS)
    for (const maxRenders of [undefined, 9, 6, 4, 2]) {
      const seen: string[] = []
      const { result: r, calls, render } = await run(noisyFir, firChain(true), { bothers: ['lacksClarity', 'roomNoise'] }, { maxRenders, onProgress: (stage) => void seen.push(stage) })
      expect(r.renders, `budget ${maxRenders}`).toBeLessThanOrEqual(maxRenders ?? DEFAULT_MAX_RENDERS)
      expect(calls.length).toBe(r.renders)
      for (const [stage, share] of Object.entries(STAGE_RENDERS)) expect(seen.filter((x) => x === stage).length, stage).toBeLessThanOrEqual(share)
      expect(sameAudio(await render(engineChanges(r.changes)), r.processed), `budget ${maxRenders}`).toBe(true)
      if (maxRenders !== undefined && maxRenders <= 4) expect(unmetKeys(r)).toContain('budget')
    }
  }, TIMEOUT)
})

describe('tune: what a tone fix may cost the room', () => {
  // no compression after the EQ, so what the cut takes off the voice it takes off the voice over the room
  const flat = (): ChainSlot[] => [eq(), { ...comp(GOOD_WET), values: { ...comp(GOOD_WET).values, ratio: 1 } }]
  const HUMP = [0, 0, 14]

  it('"room noise" is a wish for the noise stage, not a veto on the tone: the hump is cut while the voice stays at the use’s own target over the room', async () => {
    const t = targetsOf(goalsOf({ bothers: ['roomNoise'] }))
    expect([t.snrDb, t.snrFloorDb]).toEqual([45, 30])
    expect(targetsOf(goalsOf({ use: 'calls', bothers: ['roomNoise'] })).snrFloorDb).toBe(25)
    const { result: r } = await run({ noiseDb: -58, tone: HUMP }, flat(), { bothers: ['roomNoise'] })
    const plain = await run({ noiseDb: -58, tone: HUMP }, flat())
    // the same tone fix as without the complaint, although it costs 2–3 dB of voice over the room
    expect(valueChanges(r.changes).filter((c) => c.stage === 'tone')).toEqual(valueChanges(plain.result.changes).filter((c) => c.stage === 'tone'))
    expect(r.after.tone[2]).toBeLessThan(r.before.tone[2] - 3)
    expect(r.after.snrDb).toBeLessThan(r.before.snrDb - 1.5)
    expect(r.after.snrDb).toBeGreaterThanOrEqual(t.snrFloorDb)
    // the wish is still reported as not reached (nothing in this chain removes noise), without blaming the EQ
    expect(unmetKeys(r)).toContain('noise.noTool')
    expect(unmetKeys(r)).not.toContain('tone.room')
    expect(unmetKeys(plain.result)).not.toContain('noise.noTool')
  }, TIMEOUT)

  it('a fix that would take the voice further under the use’s own target is not kept, with or without the complaint, and the result says why', async () => {
    for (const bothers of [[], ['roomNoise']] as const) {
      const { result: r, calls } = await run({ noiseDb: -51, tone: HUMP }, flat(), { bothers: [...bothers] })
      expect(r.before.snrDb).toBeLessThan(30)
      expect(calls.length).toBeGreaterThan(1)
      expect(valueChanges(r.changes).filter((c) => c.stage === 'tone')).toEqual([])
      const said = r.unmet.find((m) => m.key === 'desktop.autotune.unmet.tone.room')
      expect(Number(said?.params?.db)).toBeGreaterThanOrEqual(1)
      expect(Number(said?.params?.db)).toBeLessThan(12)
      expect(unmetKeys(r)).toContain('tone.limitHigh')
    }
  }, TIMEOUT)
})

describe('retune: a result with a switch', () => {
  it('starts from the switched chain and keeps the switch while it still measures better; "too processed" leaves it be', async () => {
    const first = await run({}, firChain())
    expect(switches(first.result)).toHaveLength(1)
    const more = await tune({ ...first.input, ...retune(first.result, ['harsh']) })
    expect(switches(more)).toMatchObject([{ kind: 'switch', on: false, slot: -1 }])
    // the previous render was reused: the retune did not render the start again
    expect(more.renders).toBeLessThanOrEqual(first.result.renders)
    expect(sameAudio(await first.render(engineChanges(more.changes)), more.processed)).toBe(true)
    const lighter = retune(first.result, 'tooProcessed')
    expect((lighter.start ?? []).filter((c) => c.kind === 'switch')).toEqual(switches(first.result))
    const less = await tune({ ...first.input, ...lighter })
    expect(switches(less)).toHaveLength(1)
    expect(Math.abs(less.after.tone[1])).toBeLessThan(3)
  }, TIMEOUT)
})

describe('speech cut by a gate: measured against the ungated chain, never traded for the room', () => {
  const SR = 48000
  /** The take with every syllable's first `ms` held `db` down: what a gate opening late does. */
  function chopped(x: Float32Array, ms: number, db: number): Float32Array {
    const mask = prepareTake(x)
    if (!mask) throw new Error('no take')
    const out = x.slice()
    const speech = new Set(mask.speech)
    const n = Math.round((ms / 1000) * SR)
    for (const f of mask.speech) {
      if (speech.has(f - 1)) continue
      for (let i = f * mask.win; i < f * mask.win + n; i++) out[i] *= 10 ** (db / 20)
    }
    return out
  }

  it('cutOf: nothing for the same audio, clearly bad for chopped word starts, a shallow floor counts little and is no cut event', () => {
    const x = testTake({ speechDb: -21, noiseDb: -50 })
    const mask = prepareTake(x)
    if (!mask) throw new Error('no take')
    const open = fineLevels(x, SR)
    expect(cutOf(mask, x, open)).toMatchObject({ share: 0, events: 0 })
    // a plain gain is not a cut (the open gate's own gain is taken out)
    expect(cutOf(mask, x.map((v) => v * 0.5), open).share).toBe(0)
    const hard = cutOf(mask, chopped(x, 60, -20), open)
    expect(100 * hard.share).toBeGreaterThan(3)
    expect(hard.events).toBeGreaterThan(5)
    const soft = cutOf(mask, chopped(x, 60, -6), open)
    expect(soft.events).toBe(0)
    expect(soft.share).toBeLessThan(hard.share / 4)
    expect(cutsSpeech({ cutShare: hard.share, cutEvents: hard.events })).toBe(true)
    expect(cutsSpeech({ cutShare: 0.002, cutEvents: 0.9 })).toBe(false)
  })

  it('the keep rule: no gain on the room pays for cut words', () => {
    const t = targetsOf(goalsOf({ bothers: ['roomNoise'] }))
    const x = testTake({ speechDb: -21, noiseDb: -45 })
    const mask = prepareTake(x)
    if (!mask) throw new Error('no take')
    const noisy = { ...measure(mask, x), cutShare: 0, cutEvents: 0 }
    // 20 dB more voice over the room, for word starts cut 3 times every 10 s
    const gated = { ...noisy, pauseDb: noisy.pauseDb - 20, snrDb: noisy.snrDb + 20, cutShare: 0.03, cutEvents: 3 }
    const [before, after] = [scoreOf(noisy, t), scoreOf(gated, t)]
    expect(after.noise).toBeLessThan(before.noise - 25)
    expect(after.damage).toBeGreaterThan(before.damage + 15)
    expect(worseBecause(before, after, 'noise')).toMatch(/damage got worse/)
    // not measured (no ungated render yet): it does not count either way
    expect(scoreOf({ ...gated, cutShare: NaN, cutEvents: NaN }, t).damage).toBe(before.damage)
  })

  it('a gate that chops the quiet phrases is found on the chain as it is and made gentle until it does not, whatever the room', async () => {
    // behind the compressor, threshold inside the speech: every other phrase (14 dB quieter) is held down
    const chain: ChainSlot[] = [eq(), comp(GOOD_WET), { ...gate({ thresholdDb: -18, dryDb: -20 }), index: 4 }]
    const { result: r, render } = await run({ noiseDb: -48, phraseDb: [0, -14] }, chain, { bothers: ['roomNoise'] })
    expect(100 * r.before.cutSpeech).toBeGreaterThan(5)
    expect(r.before.cutEvents).toBeGreaterThan(2)
    expect(100 * r.after.cutSpeech).toBeLessThanOrEqual(1)
    expect(r.after.cutEvents).toBeLessThanOrEqual(1)
    const moved = valueChanges(r.changes).filter((c) => c.slot === 4)
    expect(moved.length).toBeGreaterThan(0)
    expect(sameAudio(await render(engineChanges(r.changes)), r.processed)).toBe(true)
    // the room is still there and the result says why, in the words for it
    if (r.after.snrDb < 44) expect(unmetKeys(r).some((k) => k === 'noise.wouldCut' || k === 'noise.limit')).toBe(true)
    expect(unmetKeys(r)).not.toContain('cut')
  }, TIMEOUT)
})

describe('the room in the measurement: masked bands, pumping, the loud-room note', () => {
  const noisyMids = (x: Float32Array): Float32Array => {
    // a room that is as loud as the voice at 640 Hz–2.5 kHz and quiet elsewhere
    const out = x.slice()
    let seed = 7
    const c = biquad({ type: 'Band', freq: 1250, gain: 20, bw: 2 }, 48000)
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0
    for (let i = 0; i < out.length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0
      const n = (seed / 2 ** 32 - 0.5) * 4e-2
      const y0 = (c.b0 * n + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2) / c.a0
      x2 = x1
      x1 = n
      y2 = y1
      y1 = y0
      out[i] += y0
    }
    return out
  }

  it('a band where the raw take is room, not voice, is masked in every render; taking the room out there is not tone damage', () => {
    const x = noisyMids(testTake({ speechDb: -21, noiseDb: -80, tone: [0, 0, 0, 0, -12, -12] }))
    const mask = prepareTake(x)
    if (!mask) throw new Error('no take')
    expect(mask.masked[4] || mask.masked[5]).toBe(true)
    expect(mask.masked[2]).toBe(false)
    const t = targetsOf(goalsOf())
    const withRoom = measure(mask, x)
    // the same voice with the room gone (what a remover leaves)
    const clean = measure(mask, testTake({ speechDb: -21, noiseDb: -80, tone: [0, 0, 0, 0, -12, -12] }))
    const [a, b] = [scoreOf(withRoom, t), scoreOf(clean, t)]
    mask.masked.forEach((m, band) => m && expect(Number.isNaN(toneOf(withRoom, t)[band])).toBe(true))
    expect(Math.abs(a.tone - b.tone)).toBeLessThan(1.5)
    // a quiet take masks nothing
    expect(prepareTake(testTake({ speechDb: -21, noiseDb: -80 }))?.masked.some(Boolean)).toBe(false)
  })

  it('pumping: a deep gate over an audible room is damage, a shallow one or a quiet room is not', () => {
    const x = testTake({ speechDb: -21, noiseDb: -45 })
    const mask = prepareTake(x)
    if (!mask) throw new Error('no take')
    const open = fineLevels(x, 48000)
    const gated = (db: number): Float32Array => {
      const out = x.slice()
      const speech = new Set(mask.speech)
      for (let f = 0; f < mask.frames; f++) if (!speech.has(f) && !speech.has(f - 1) && !speech.has(f + 1)) for (let i = f * mask.win; i < (f + 1) * mask.win; i++) out[i] *= 10 ** (db / 20)
      return out
    }
    expect(cutOf(mask, gated(-20), open).pump).toBeGreaterThan(17)
    expect(cutOf(mask, gated(-6), open).pump).toBeLessThan(8)
    expect(pumps({ pumpDb: cutOf(mask, gated(-20), open).pump })).toBe(true)
    expect(pumps({ pumpDb: cutOf(mask, gated(-6), open).pump })).toBe(false)
    const quiet = testTake({ speechDb: -21, noiseDb: -75 })
    const qm = prepareTake(quiet)
    if (!qm) throw new Error('no take')
    expect(cutOf(qm, quiet, fineLevels(quiet, 48000)).pump).toBe(0)
    const t = targetsOf(goalsOf())
    const m = { ...measure(mask, x), cutShare: 0, cutEvents: 0 }
    expect(scoreOf({ ...m, pumpDb: 20 }, t).damage).toBeGreaterThan(scoreOf({ ...m, pumpDb: 8 }, t).damage + 8)
  })

  it('a loud room gets the note about the room itself; a Noise Removal that silences the pauses is said, not counted as damage', async () => {
    const chain: ChainSlot[] = [noiseRemoval(44, false), eq(), comp(GOOD_WET)]
    const loud = await run({ noiseDb: -36 }, chain, { amount: 'strong' })
    expect(loud.result.unmet[0]).toMatchObject({ key: 'desktop.autotune.unmet.room.loud' })
    expect(Number(loud.result.unmet[0].params?.snr)).toBeLessThan(20)
    const quiet = await run({ noiseDb: -70 }, chain)
    expect(unmetKeys(quiet.result)).not.toContain('room.loud')
    // the fake remover zeroes the pauses from strength 80: with the room this loud the strong amount gets there
    if (loud.result.after.deadSilence > 0.05) {
      expect(unmetKeys(loud.result)).toContain('silentPauses')
      expect(unmetKeys(loud.result)).not.toContain('dead')
      expect(loud.result.after.score.damage).toBeLessThan(5)
    }
    expect(loud.result.after.snrDb).toBeGreaterThan(loud.result.before.snrDb + 2)
  }, TIMEOUT)
})

describe('peaks are a hard limit; "too loud" and "crackling"', () => {
  it('the goals: too loud aims 2 dB lower (cancels with too quiet), crackling keeps the peaks 4 dB lower', () => {
    const base = targetsOf(goalsOf())
    expect(targetsOf(goalsOf({ bothers: ['tooLoud'] })).speechDb).toBe(base.speechDb - 2)
    expect(targetsOf(goalsOf({ bothers: ['tooLoud', 'tooQuiet'] })).speechDb).toBe(base.speechDb)
    expect(targetsOf(goalsOf({ bothers: ['crackling'] })).peakCeilDb).toBe(base.peakCeilDb - 4)
    expect(targetsOf(goalsOf({ bothers: ['crackling'] })).speechDb).toBe(base.speechDb)
  })

  it('peakSpots: tells spikes right after silence from sustained loud speech', () => {
    const sr = 48000
    const x = new Float32Array(sr * 2)
    for (let i = sr; i < sr * 2; i++) x[i] = 0.1 * Math.sin((2 * Math.PI * 220 * i) / sr)
    // a word start out of digital silence with a spike on it
    for (let i = sr; i < sr + 96; i++) x[i] = 0.9
    expect(peakSpots({ sampleRate: sr }, x)).toEqual({ spikes: 1, onsets: 1 })
    const loud = new Float32Array(sr * 2)
    for (let i = 0; i < loud.length; i++) loud[i] = 0.5 * Math.sin((2 * Math.PI * 220 * i) / sr)
    const s = peakSpots({ sampleRate: sr }, loud)
    expect(s.spikes).toBeGreaterThan(100)
    expect(s.onsets).toBe(0)
  })

  /** Short spikes 20 dB over the voice on some word starts, after the chain (what gets through a compressor's attack). */
  const spikes = (x: Float32Array): void => {
    for (let i = 3.2 * 48000; i < x.length; i += 1.7 * 48000) for (let k = 0; k < 48; k++) x[Math.round(i) + k] = k % 2 ? 0.95 : -0.95
  }

  it('a result never ends over the ceiling while a lower Wet can prevent it: the voice ends quieter and the result says why', async () => {
    for (const bothers of [[], ['crackling'], ['tooLoud']] as const) {
      const chain: ChainSlot[] = [eq(), comp(GOOD_WET)]
      const { result: r, render } = await run({}, chain, { bothers: [...bothers] }, {}, { post: (x, live) => {
        // the spikes ride on the make-up gain like the voice does
        const wet = live.find((c) => c.kind === 'reacomp')?.values.wetDb ?? 0
        const g = 10 ** ((wet - GOOD_WET) / 20)
        for (let i = 3.2 * 48000; i < x.length; i += 1.7 * 48000) for (let k = 0; k < 48; k++) x[Math.round(i) + k] = (k % 2 ? 0.95 : -0.95) * g
      } })
      const t = targetsOf(r.goals)
      expect(r.before.peakDb, String(bothers)).toBeGreaterThan(t.peakCeilDb)
      expect(r.after.peakDb, String(bothers)).toBeLessThanOrEqual(t.peakCeilDb + 0.05)
      const wet = valueChanges(r.changes).find((c) => c.key === 'wetDb')
      expect(wet?.to).toBeLessThan(GOOD_WET)
      expect(wet?.titleMsg.key).toMatch(/reason\.level\.(peaks|down)|reason\.trim\.down/)
      if (r.after.speechDb < t.speechDb - 2) expect(unmetKeys(r)).toContain('level.peaks')
      expect(unmetKeys(r)).not.toContain('peak.over')
      expect(sameAudio(await render(engineChanges(r.changes)), r.processed)).toBe(true)
    }
    void spikes
  }, TIMEOUT)

  it('no compressor to turn down: the peak stays over and the result says it still distorts', async () => {
    const { result: r } = await run({ speechDb: -8 }, [eq()], {}, {}, { post: (x) => spikes(x) })
    expect(r.after.peakDb).toBeGreaterThan(targetsOf(r.goals).peakCeilDb)
    expect(unmetKeys(r)).toContain('peak.over')
    const rows = metricRows(r)
    expect(rows.find((x) => x.id === 'peak')?.dir).toBe('over')
  }, TIMEOUT)

  it('result rows: silence is silence, a hidden band says so, a band inside its tolerance is not listed', () => {
    const t0 = [0, 6, 0, NaN, 2, 0, 0, 0, 0]
    const sum = (o: object) => ({ speechDb: -21, peakDb: -6, clipped: 0, pauseDb: -60, snrDb: 39, tone: t0, spreadDb: 7, deadSilence: 0, gateSwitches: 0, wordLossDb: 0, cutSpeech: 0, cutEvents: 0, pumpDb: 0, burstDb: NaN, burstEvents: 0, removerCut: NaN, removerCutEvents: NaN, score: { level: 0, noise: 0, tone: 0, consistency: 0, damage: 0, total: 0 }, ...o })
    const rows = metricRows({ before: sum({ pauseDb: -100, snrDb: 79, peakDb: 3 }), after: sum({ pauseDb: -100, snrDb: 70, peakDb: -4, tone: [0, 1, 0, NaN, 0.5, 0, 0, 0, 0] }), goals: goalsOf(), limit: 1 })
    const by = (id: string, band?: number) => rows.find((r) => r.id === id && r.band === band)
    expect(by('peak')?.dir).toBe('better')
    expect(by('noise')).toMatchObject({ dir: 'same', beforeNote: 'silence', afterNote: 'silence' })
    expect(by('snr')).toMatchObject({ dir: 'same', beforeNote: 'none', afterNote: 'none' })
    expect(by('band', 3)).toMatchObject({ beforeNote: 'hidden', afterNote: 'hidden', dir: 'same' })
    expect(by('band', 1)?.dir).toBe('better')
    // 2 → 0.5 dB: inside the tolerance before and after
    expect(by('band', 4)).toBeUndefined()
  })
})

describe('the final trim is judged on level, peaks and speech damage only', () => {
  it('a remover behind the compressor that changes the tone with the level cannot veto the trim: the voice ends on target', async () => {
    // ReaEQ → ReaComp → Noise Removal (on); the remover dulls the top 1 dB for every dB its input is over −30 dBFS
    const chain = (): ChainSlot[] => [eq(), comp(0), { ...noiseRemoval(10), index: 5 }]
    const { result: r, render } = await run({ speechDb: -33, noiseDb: -75 }, chain(), {}, {}, { removerReactsDb: 1 })
    const t = targetsOf(r.goals)
    expect(r.before.speechDb).toBeLessThan(t.speechDb - 5)
    expect(Math.abs(r.after.speechDb - t.speechDb)).toBeLessThanOrEqual(1.5)
    expect(r.after.peakDb).toBeLessThanOrEqual(t.peakCeilDb + 0.05)
    expect(r.after.wordLossDb).toBeLessThanOrEqual(2)
    expect(r.after.cutSpeech).toBe(0)
    expect(unmetKeys(r)).not.toContain('level.held')
    expect(sameAudio(await render(engineChanges(r.changes)), r.processed)).toBe(true)
    // a remover that does not react needs no note about the tone
    const calm = await run({ speechDb: -33, noiseDb: -75 }, chain())
    expect(unmetKeys(calm.result)).not.toContain('level.toneMoved')
  }, TIMEOUT)
})
