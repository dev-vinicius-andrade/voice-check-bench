// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { ChainSlot } from '../advice/types'
import { burstsCost, burstStage } from './burstStage'
import { fakeRenderer } from './fakeRenderer'
import { BURST_FROM_SEC, BURST_GUARD_SEC, burstsOf, CUT_FRAME_SEC, measure, MIN_ROOM_FRAMES, prepareTake, type TakeMask } from './measure'
import { heardSnrDb, scoreOf } from './score'
import { Session } from './session'
import { targetsOf } from './targets'
import { testTake } from './testTake'
import { tune } from './tune'
import type { TuneGoals } from './types'

const SR = 48000
const W = Math.round(CUT_FRAME_SEC * SR)
const goals = (g: Partial<TuneGoals> = {}): TuneGoals => ({ use: 'streaming', style: 'natural', bothers: [], amount: 'medium', ...g })
const take = testTake({ speechDb: -21, noiseDb: -45 })
const mask = prepareTake(take) as TakeMask
if (!mask) throw new Error('test take not analysable')
const speechDb = measure(mask, take).speechDb

/** What a remover that takes the room out of every pause frame makes of the take (frames next to speech left alone). */
function silenced(): Float32Array {
  const out = take.slice()
  for (const f of mask.pause) out.fill(0, f * mask.win, (f + 1) * mask.win)
  return out
}

/** Runs of `len` consecutive room frames, `count` of them, spread over the take. */
function roomRuns(len: number, count: number): number[] {
  const starts: number[] = []
  const room = mask.roomFrames
  for (let k = 0; k + len <= room.length; k++) {
    if (room[k + len - 1] !== room[k] + len - 1) continue
    if (starts.length && room[k] - starts[starts.length - 1] < 50) continue
    starts.push(room[k])
    if (starts.length === count) break
  }
  return starts
}

describe('bursts in the pauses', () => {
  it('room frames: the pauses after the first second, away from speech', () => {
    expect(mask.roomFrames.length).toBeGreaterThan(MIN_ROOM_FRAMES)
    expect(mask.roomFrames[0] * CUT_FRAME_SEC).toBeGreaterThanOrEqual(BURST_FROM_SEC)
    const per = Math.round(mask.win / W)
    const guard = Math.round(BURST_GUARD_SEC / CUT_FRAME_SEC)
    const near = (i: number): boolean => mask.speech.some((f) => i >= f * per - guard && i < (f + 1) * per + guard)
    expect(mask.roomFrames.some(near)).toBe(false)
  })

  it('steady room noise is no burst', () => {
    const b = burstsOf(mask, take, speechDb)
    expect(b.burstDb).toBeNaN()
    expect(b.burstEvents).toBe(0)
  })

  it('silent pauses with short room bursts in them are flagged, with how far under the voice the loudest sits', () => {
    const out = silenced()
    const starts = roomRuns(6, 3)
    expect(starts).toHaveLength(3)
    for (const f of starts) out.set(take.subarray(f * W, (f + 6) * W), f * W)
    const b = burstsOf(mask, out, speechDb)
    expect(b.burstEvents).toBeGreaterThan(0)
    // the room plays at −45 dBFS RMS, a 10 ms frame of it a dB or two over that
    expect(b.burstDb).toBeGreaterThan(speechDb + 45 - 4)
    expect(b.burstDb).toBeLessThan(speechDb + 45 + 1)
    const m = { ...measure(mask, out) }
    expect(m.burstDb).toBeCloseTo(b.burstDb, 6)
    // the median pause reads digital silence; heard, the pauses sit at the loudest burst
    expect(m.snrDb).toBeGreaterThan(60)
    expect(heardSnrDb(m)).toBeCloseTo(b.burstDb, 6)
    const t = targetsOf(goals())
    expect(scoreOf(m, t).noise).toBeGreaterThan(scoreOf({ ...m, burstDb: NaN }, t).noise + 5)
    expect(burstsCost(m, t.snrDb)).toBe(true)
  })

  it('a single 10 ms click is no burst', () => {
    const out = silenced()
    const [f] = roomRuns(3, 1)
    out.set(take.subarray(f * W, (f + 1) * W), f * W)
    expect(burstsOf(mask, out, speechDb).burstEvents).toBe(0)
  })

  it('word tails (the room kept right after the words) are no burst', () => {
    const out = silenced()
    const tail = Math.round(0.12 * SR)
    for (const f of mask.speech) {
      const end = (f + 1) * mask.win
      out.set(take.subarray(end, Math.min(take.length, end + tail)), end)
    }
    expect(burstsOf(mask, out, speechDb).burstEvents).toBe(0)
  })

  it('the first second (Noise Removal still converging in a render) is not judged', () => {
    const out = silenced()
    const from = Math.round(0.6 * SR)
    out.set(take.subarray(from, Math.round(0.95 * SR)), from)
    expect(burstsOf(mask, out, speechDb).burstEvents).toBe(0)
  })

  it('bursts far under the voice are not heard', () => {
    const out = silenced()
    for (const f of roomRuns(6, 3)) for (let i = f * W; i < (f + 6) * W; i++) out[i] = take[i] * 10 ** (-30 / 20)
    expect(burstsOf(mask, out, speechDb).burstEvents).toBe(0)
  })

  it('a sound of the recording in a pause (an "s", a breath at room level) is not a burst', () => {
    const raw = take.slice()
    const [f] = roomRuns(12, 1)
    const at = (f + 2) * W
    for (let i = 0; i < 8 * W; i++) raw[at + i] += 0.02 * Math.sin((2 * Math.PI * 7000 * i) / SR)
    const own = prepareTake(raw) as TakeMask
    const out = raw.slice()
    for (const p of own.pause) out.fill(0, p * own.win, (p + 1) * own.win)
    out.set(raw.subarray(at, at + 8 * W), at)
    expect(own.roomFrames.includes(f + 4)).toBe(false)
    expect(burstsOf(own, out, speechDb).burstEvents).toBe(0)
  })

  it('not measurable without room frames or a voice', () => {
    expect(burstsOf({ ...mask, roomFrames: mask.roomFrames.slice(0, MIN_ROOM_FRAMES - 1) }, take, speechDb).burstEvents).toBeNaN()
    expect(burstsOf(mask, take, NaN).burstDb).toBeNaN()
  })
})

describe('burst stage', () => {
  // ReaComp (make-up Wet) → a doubled ReaGate (the voice passes twice) → Noise Removal (pauses to digital silence)
  // that lets the room through for a moment when what it receives is loud enough
  const chain = (): ChainSlot[] => [
    { index: 0, kind: 'reacomp', name: 'ReaComp (ReaPlugs Edition)', on: true, values: { thresholdDb: -10, ratio: 1, attackMs: 5, releaseMs: 100, wetDb: -6 } },
    { index: 1, kind: 'reagate', name: 'ReaGate (ReaPlugs Edition)', on: true, values: { thresholdDb: -60, holdMs: 200, releaseMs: 300, wetDb: 0, dryDb: 0 } },
    { index: 2, kind: 'noiseRemoval', name: 'Elgato Noise Removal', on: true, values: { strength: 80 } },
  ]
  const leaky = { removerLeaksAboveDb: -50 }

  it('closes the gate before Noise Removal in the pauses and gives the voice its level back', async () => {
    const { render } = fakeRenderer(take, chain(), leaky)
    const base = measure(mask, await render([]))
    expect(burstsCost(base, 30)).toBe(true)
    const r = await tune({ take, goals: goals(), chain: chain(), render })
    const gate = r.changes.filter((c) => c.slot === 1 && c.kind === 'value')
    expect(gate.some((c) => c.kind === 'value' && c.key === 'dryDb' && c.to <= -12)).toBe(true)
    expect(r.after.burstDb).toBeNaN()
    expect(Math.abs(r.after.speechDb - targetsOf(goals()).speechDb)).toBeLessThan(1.5)
    expect(r.after.cutEvents).toBeLessThanOrEqual(1)
    expect(r.unmet.map((u) => u.key)).not.toContain('desktop.autotune.unmet.bursts')
    expect(r.log.some((l) => l.event === 'keep' && l.text.includes('bursts'))).toBe(true)
  })

  it('says so when nothing removes them, and changes nothing for them', async () => {
    // no gate before the remover: nothing in reach feeds it less room
    const noGate = chain().filter((c) => c.kind !== 'reagate')
    const { render } = fakeRenderer(take, noGate, { removerLeaksAboveDb: -60 })
    const r = await tune({ take, goals: goals(), chain: noGate, render })
    expect(r.unmet.map((u) => u.key)).toContain('desktop.autotune.unmet.bursts')
    expect(Number.isFinite(r.after.burstDb)).toBe(true)
  })

  it('does nothing without bursts or without Noise Removal on', async () => {
    const quiet = chain()
    const { render } = fakeRenderer(take, quiet)
    const s = new Session({ chain: quiet, mask, targets: targetsOf(goals()), render, maxRenders: 20 })
    const { audio, m } = await s.render('baseline', s.set)
    s.audio = audio
    s.m = m
    const before = s.renders
    await burstStage(s)
    expect(s.renders).toBe(before)
  })
})
