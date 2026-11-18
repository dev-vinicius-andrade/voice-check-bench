import { describe, expect, it } from 'vitest'
import type { ChainSlot } from '../advice/types'
import { NoiseCalibrator, QUIET_SEC } from './calibrator'
import { FakeLive, framesOf, noise, speech, type FakeLiveOptions } from './testLive'
import type { CalCommand, CalView } from './types'

const ROOM = -37
const FIR: ChainSlot = { index: 0, kind: 'reafir', name: 'ReaFIR (ReaPlugs Edition)', on: true, values: {} }
const comp = (wetDb = 0): ChainSlot => ({ index: 2, kind: 'reacomp', name: 'ReaComp (ReaPlugs Edition)', on: true, values: { thresholdDb: -20, ratio: 3, attackMs: 3, releaseMs: 100, wetDb } })
const gate = (v: Record<string, number> = {}): ChainSlot => ({ index: 3, kind: 'reagate', name: 'ReaGate (ReaPlugs Edition)', on: true, values: { thresholdDb: -72, holdMs: 100, releaseMs: 100, wetDb: 0, dryDb: -100, ...v } })
const nr = (on: boolean, strength = 85): ChainSlot => ({ index: 4, kind: 'noiseRemoval', name: 'Elgato Noise Removal', on, values: { strength } })
/** The user's chain as the live screen plays it: ReaFIR → ReaComp → ReaGate (open) → Noise Removal on its own bypass. */
const userChain = (): ChainSlot[] => [FIR, comp(), gate(), nr(false)]

const quietFrames = framesOf(noise(48000 * 90, ROOM, 3))
const talkFrames = framesOf(speech(90, ROOM))

interface Rig {
  cal: NoiseCalibrator
  live: FakeLive
  /** Pushes frames (the person quiet, or talking while asked to) until `until` says stop. */
  run(until: (v: CalView) => boolean, opts?: { maxSec?: number; talk?: (v: CalView) => boolean }): CalView
  push(raw: Float32Array, extra?: Parameters<FakeLive['frame']>[1]): CalCommand[]
}

function rig(chain: ChainSlot[], opts: Partial<FakeLiveOptions> = {}, amount: 'light' | 'medium' | 'strong' = 'medium'): Rig {
  const cal = new NoiseCalibrator()
  const live = new FakeLive(chain, { roomDb: ROOM, ...opts })
  let q = 0
  let t = 0
  const push = (raw: Float32Array, extra?: Parameters<FakeLive['frame']>[1]): CalCommand[] => {
    const cmds = cal.push(live.frame(raw, extra))
    live.apply(cmds)
    return cmds
  }
  live.apply(cal.start(live.chain, amount))
  return {
    cal,
    live,
    push,
    run(until, o = {}) {
      const talks = o.talk ?? ((v) => v.phase === 'talk' || v.phase === 'verify')
      for (let k = 0; k < (o.maxSec ?? 120) * 10; k++) {
        const v = cal.view
        if (until(v)) return v
        push(talks(v) ? talkFrames[t++ % talkFrames.length] : quietFrames[q++ % quietFrames.length])
      }
      throw new Error(`still ${cal.view.phase}`)
    },
  }
}

const done = (v: CalView): boolean => v.phase === 'done'
const strength = (live: FakeLive): number => live.chain.find((s) => s.kind === 'noiseRemoval')?.values.strength ?? NaN
const on = (live: FakeLive, kind: ChainSlot['kind']): boolean => live.chain.find((s) => s.kind === kind)?.on ?? false
const setTargets = (log: readonly CalCommand[]): string[] => log.map((c) => `${c.kind} ${c.target}`)

describe('noise calibration: Noise Removal', () => {
  it('switches a Noise Removal on its own bypass on, steps the ladder until the pauses are silent, then takes ReaFIR out', () => {
    const r = rig(userChain())
    const v = r.run(done)
    // 0 (−10 dB) → 5 (silent with ReaFIR) → ReaFIR off (no longer) → 10 (silent alone)
    expect(setTargets(r.live.log)).toEqual(['set 4:on', 'set 4:strength', 'set 4:strength', 'set 0:on', 'set 4:strength'])
    expect(r.live.log.filter((c) => c.kind === 'set').map((c) => (c.kind === 'set' && c.change.kind === 'value' ? c.change.to : null))).toEqual([null, 0, 5, null, 10])
    expect(strength(r.live)).toBe(10)
    expect(on(r.live, 'noiseRemoval')).toBe(true)
    expect(on(r.live, 'reafir')).toBe(false)
    expect(r.live.chain.find((s) => s.kind === 'reagate')).toEqual(gate())
    const s = v.summary!
    expect(s.roomDb).toBeCloseTo(ROOM, 0)
    expect(s.beforeDb).toBeGreaterThan(-50)
    expect(s.afterDb).toBeLessThanOrEqual(-65)
    expect(s.silent).toBe(true)
    expect(s.cutShare).toBeLessThan(0.01)
    expect(s.notes).toEqual([])
    expect(s.changes.map((m) => m.params?.plugin)).toEqual(['Elgato Noise Removal', 'Elgato Noise Removal', 'ReaFIR'])
    // one entry per value: the strength line runs from before the calibration
    const last = [...r.live.log].reverse().find((c) => c.kind === 'set' && c.target === '4:strength')
    expect(last?.kind === 'set' && last.change.kind === 'value' && last.change.from).toBe(85)
  })

  it('waits for the Noise Removal to follow each change before it measures', () => {
    // the remover takes 650 ms to follow: a measurement taken any sooner would read the room untouched
    const r = rig(userChain(), { nrFollowMs: 650 })
    r.run(done)
    expect(strength(r.live)).toBe(10)
  })

  it('starts the quiet phase over when the person talks, and says so', () => {
    const r = rig(userChain())
    r.run((v) => v.progress > 0.4)
    for (const f of talkFrames.slice(0, 5)) r.push(f)
    const v = r.cal.view
    expect(v.phase).toBe('quiet')
    expect(v.notice?.key).toBe('desktop.tune.calibrate.notice.talkedQuiet')
    expect(v.progress).toBeLessThan(0.1)
    expect(v.leftSec).toBeGreaterThan(QUIET_SEC - 0.5)
    expect(r.run(done).phase).toBe('done')
  })

  it('talking while a change is measured repeats that measurement, not the ladder', () => {
    const r = rig(userChain())
    r.run((v) => v.phase === 'set' && v.progress > 0.5)
    const before = r.live.log.length
    for (const f of talkFrames.slice(0, 8)) r.push(f)
    expect(r.cal.view.notice?.key).toBe('desktop.tune.calibrate.notice.talkedSet')
    expect(r.live.log.length).toBe(before)
    r.run(done)
    expect(strength(r.live)).toBe(10)
  })

  it('words cut at the silent strength: one rung back, checked again; the result says words came first', () => {
    // from strength 0 on the remover closes 0.6 dB higher per point: at 10 it eats the quiet syllables
    const r = rig(userChain(), { chopFrom: 0 })
    const v = r.run(done)
    expect(strength(r.live)).toBe(5)
    expect(v.summary?.notes.map((n) => n.key)).toContain('desktop.tune.calibrate.note.wordsFirst')
    expect(v.summary?.cutShare).toBeLessThan(0.01)
  })

  it('words cut even at the lightest strength: everything goes back as it was', () => {
    const r = rig(userChain(), { chopFrom: -12 })
    const v = r.run(done)
    expect(r.live.chain).toEqual(userChain())
    expect(v.summary?.notes.map((n) => n.key)).toContain('desktop.tune.calibrate.note.wouldCut')
    expect(v.summary?.changes).toEqual([])
  })

  it('asks again when nobody talks in the talk phase, and does not guess', () => {
    const r = rig(userChain())
    r.run((v) => v.phase === 'talk')
    const v = r.run((x) => x.notice?.key === 'desktop.tune.calibrate.notice.noSpeech', { talk: () => false, maxSec: 25 })
    expect(v.phase).toBe('talk')
    expect(v.summary).toBeNull()
    expect(r.run(done).summary?.silent).toBe(true)
  })

  it('cancel midway puts every value back, last first', () => {
    const r = rig(userChain())
    r.run((v) => v.phase === 'set' && strength(r.live) === 5)
    const cmds = r.cal.cancel()
    r.live.apply(cmds)
    expect(cmds).toEqual([
      { kind: 'revert', target: '4:strength' },
      { kind: 'revert', target: '4:on' },
    ])
    expect(r.live.chain).toEqual(userChain())
    expect(r.cal.view.phase).toBe('idle')
    expect(r.cal.view.notice?.key).toBe('desktop.tune.calibrate.notice.cancelled')
    expect(r.cal.cancel()).toEqual([])
  })

  it('a stream gap or unsettled audio is never measured', () => {
    const r = rig(userChain())
    r.run((v) => v.progress > 0.5)
    const p = r.cal.view.progress
    r.push(quietFrames[0], { counters: { streamDropped: 3, inputOverruns: 0 } })
    expect(r.cal.view.notice?.key).toBe('desktop.tune.calibrate.notice.gap')
    expect(r.cal.view.progress).toBeLessThan(p)
    const q = r.cal.view.progress
    for (let k = 0; k < 10; k++) r.push(quietFrames[k], { settled: false })
    for (let k = 0; k < 10; k++) r.push(quietFrames[k], { latencyChanged: true })
    expect(r.cal.view.progress).toBe(q)
    // a frame missing from the sequence is a gap too
    const fake = r.live as unknown as { seq: number }
    fake.seq += 3
    r.push(quietFrames[1])
    expect(r.cal.view.progress).toBeLessThanOrEqual(0.03)
  })

  it('the engine stopping under it ends the calibration without commands', () => {
    const r = rig(userChain())
    r.run((v) => v.phase === 'set')
    r.cal.engineStopped()
    expect(r.cal.view.phase).toBe('idle')
    expect(r.cal.view.notice?.key).toBe('desktop.tune.calibrate.notice.engineStopped')
    expect(r.push(quietFrames[0])).toEqual([])
    expect(r.cal.undoAll()).toEqual([])
  })

  it('already silent pauses and no ReaFIR: nothing changes', () => {
    const r = rig([comp(), nr(true, 10)])
    const v = r.run(done)
    expect(r.live.log).toEqual([])
    expect(v.summary?.notes.map((n) => n.key)).toEqual(['desktop.tune.calibrate.note.alreadySilent'])
  })

  it('a chain with nothing that removes noise says so at once', () => {
    const r = rig([FIR, comp()])
    expect(r.cal.view.phase).toBe('done')
    expect(r.cal.view.summary?.notes.map((n) => n.key)).toEqual(['desktop.tune.calibrate.note.nothing'])
    expect(r.cal.view.canMore).toBe(false)
  })

  it('More moves one rung and is checked on the next talking; one that cuts words goes back', () => {
    const r = rig(userChain(), { chopFrom: 12 })
    expect(r.cal.view.canMore).toBe(false)
    r.run(done)
    expect(strength(r.live)).toBe(10)
    expect(r.cal.view.canMore).toBe(true)
    r.live.apply(r.cal.more())
    expect(strength(r.live)).toBe(20)
    expect(r.cal.view.phase).toBe('verify')
    const v = r.run(done)
    expect(strength(r.live)).toBe(10)
    expect(v.summary?.notes.map((n) => n.key)).toContain('desktop.tune.calibrate.note.moreCuts')
    r.live.apply(r.cal.less())
    expect(strength(r.live)).toBe(5)
    r.run(done)
    expect(strength(r.live)).toBe(5)
    // Undo calibration: everything back
    r.live.apply(r.cal.undoAll())
    expect(r.live.chain).toEqual(userChain())
    expect(r.cal.view.notice?.key).toBe('desktop.tune.calibrate.notice.undone')
  })

  it('a light amount stops the ladder at its cap', () => {
    // a room the remover never silences: 0, 5, 10, 20 tried, the quietest kept
    const r = rig([nr(false)], { chopFrom: 100 }, 'light')
    const v = r.run(done)
    expect(r.live.log.filter((c) => c.kind === 'set' && c.target === '4:strength').length).toBe(3)
    expect(strength(r.live)).toBe(10)
    expect(v.summary?.silent).toBe(true)
  })
})

describe('noise calibration: a gate without Noise Removal', () => {
  it('behind a compressor: probes what the gate receives, places it a few dB over the room peaks with a floor that cannot pump', () => {
    // Wet 0 dB: Dry −12 swings an audible room 13.9 dB (over PUMP_OK_DB), so the floor is −6
    const r = rig([comp(12), gate()])
    const v = r.run(done)
    const sets = r.live.log.filter((c): c is Extract<CalCommand, { kind: 'set' }> => c.kind === 'set')
    // the probe: the gate passes everything
    expect(sets.slice(0, 2).map((c) => [c.target, c.change.kind === 'value' ? c.change.to : null])).toEqual([
      ['3:wetDb', -100],
      ['3:dryDb', 0],
    ])
    const g = r.live.chain.find((s) => s.kind === 'reagate')!
    // room −37 + 12 dB of make-up, peaks about 5 dB over the RMS → threshold about −20 + 3
    expect(g.values.thresholdDb).toBeGreaterThan(-20)
    expect(g.values.thresholdDb).toBeLessThan(-14)
    expect(g.values.wetDb).toBe(0)
    expect(g.values.dryDb).toBe(-6)
    expect(g.values.holdMs).toBe(300)
    expect(g.values.releaseMs).toBe(400)
    expect(v.summary?.afterDb).toBeLessThan(v.summary!.beforeDb - 5)
    expect(v.summary?.pumpDb).toBeLessThanOrEqual(13)
  })

  it('More takes the floor one step deeper; over an audible room that pumps, so it goes back', () => {
    const r = rig([comp(12), gate()])
    r.run(done)
    r.live.apply(r.cal.more())
    expect(r.live.chain.find((s) => s.kind === 'reagate')?.values.dryDb).toBe(-12)
    const v = r.run(done)
    expect(r.live.chain.find((s) => s.kind === 'reagate')?.values.dryDb).toBe(-6)
    expect(v.summary?.notes.map((n) => n.key)).toContain('desktop.tune.calibrate.note.morePumps')
  })

  it('without a compressor before it, the raw room peaks place it; a switched-off gate is switched on', () => {
    const r = rig([{ ...gate(), on: false }])
    r.run(done)
    const g = r.live.chain[0]
    expect(g.on).toBe(true)
    expect(g.values.thresholdDb).toBeGreaterThan(ROOM)
    expect(g.values.thresholdDb).toBeLessThan(ROOM + 12)
    expect(r.live.log.some((c) => c.kind === 'set' && c.target === '3:wetDb' && c.change.kind === 'value' && c.change.to === -100)).toBe(false)
  })
})
