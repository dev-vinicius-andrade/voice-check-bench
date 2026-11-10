import { describe, expect, it } from 'vitest'
import { holdMetrics, isHeld } from './hold'
import type { LiveMetrics, LiveSide } from './types'

const side = (p: Partial<LiveSide> = {}): LiveSide => ({
  speechDb: -20,
  peakDb: -6,
  clipFrames: 1,
  pauseDb: -70,
  deadSilence: 0,
  tone: [0, 1, -2, 4, 0, -7, 2, 0, 1],
  ...p,
})
const talk = (p: Partial<LiveMetrics> = {}): LiveMetrics => ({ talkSec: 3, raw: side({ speechDb: -26 }), fx: side(), lagMs: 20, sync: 0.9, hints: [], ...p })
const NANS = Array(9).fill(NaN)
const pause = (pauseDb = -72, deadSilence = 0.1): LiveMetrics =>
  talk({
    talkSec: 0.3,
    raw: side({ speechDb: NaN, peakDb: -50, clipFrames: 0, pauseDb: -45, tone: NANS }),
    fx: side({ speechDb: NaN, peakDb: -60, clipFrames: 0, pauseDb, deadSilence, tone: NANS }),
    hints: [{ key: 'live.hint.talkMore' }],
  })

describe('holdMetrics', () => {
  it('nothing heard yet: values as measured, heardAgo null', () => {
    const h = holdMetrics(null, pause(), 100)
    expect(h.fx.heardAgoMs).toBeNull()
    expect(h.fx.heardAtMs).toBeNull()
    expect(h.raw!.heardAgoMs).toBeNull()
    expect(h.fx.speechDb).toBeNaN()
    expect(isHeld(h.fx)).toBe(false)
  })

  it('talk → pause keeps the speech values, pause noise stays live, heardAgo grows', () => {
    let h = holdMetrics(null, talk(), 1000)
    expect(h.fx.heardAgoMs).toBe(0)
    expect(isHeld(h.fx)).toBe(false)
    h = holdMetrics(h, pause(-72, 0.1), 1500)
    expect(h.fx.speechDb).toBe(-20)
    expect(h.fx.peakDb).toBe(-6)
    expect(h.fx.clipFrames).toBe(1)
    expect(h.fx.tone).toEqual(talk().fx.tone)
    expect(h.raw!.speechDb).toBe(-26)
    expect(h.fx.pauseDb).toBe(-72)
    expect(h.raw!.pauseDb).toBe(-45)
    expect(h.fx.deadSilence).toBe(0.1)
    expect(h.talkSec).toBe(0.3)
    expect(h.hints).toEqual([]) // the talk window's advice (none here), not "keep talking"
    expect(h.fx.heardAgoMs).toBe(500)
    expect(isHeld(h.fx)).toBe(true)
    h = holdMetrics(h, pause(-74, 0), 4000)
    expect(h.fx.heardAgoMs).toBe(3000)
    expect(h.fx.heardAtMs).toBe(1000)
    expect(h.fx.pauseDb).toBe(-74)
    expect(h.fx.deadSilence).toBe(0)
  })

  it('new talk replaces the held values', () => {
    let h = holdMetrics(holdMetrics(null, talk(), 0), pause(), 2000)
    h = holdMetrics(h, talk({ fx: side({ speechDb: -30, clipFrames: 0, tone: Array(9).fill(2) }) }), 2500)
    expect(h.fx.speechDb).toBe(-30)
    expect(h.fx.clipFrames).toBe(0)
    expect(h.fx.tone).toEqual(Array(9).fill(2))
    expect(h.fx.heardAgoMs).toBe(0)
    expect(h.fx.heardAtMs).toBe(2500)
  })

  it('keeps the last pause level while a window has no pause to measure', () => {
    let h = holdMetrics(null, pause(-72), 0)
    h = holdMetrics(h, talk({ fx: side({ pauseDb: NaN }) }), 500)
    expect(h.fx.pauseDb).toBe(-72)
    expect(h.fx.speechDb).toBe(-20)
  })

  it('keeps the advice of the last window with talk through pauses; "keep talking" only before anything was heard', () => {
    const tip = [{ key: 'live.hint.levelLow' }]
    const wait = [{ key: 'live.hint.talkMore' }]
    expect(holdMetrics(null, { ...pause(), hints: wait }, 0).hints).toEqual(wait)
    const heard = holdMetrics(null, talk({ hints: tip }), 0)
    expect(holdMetrics(heard, { ...pause(), hints: wait }, 500).hints).toEqual(tip)
    const next = [{ key: 'live.hint.levelHigh' }]
    expect(holdMetrics(heard, talk({ hints: next }), 500).hints).toEqual(next)
  })

  it('without a raw mic the raw side stays null', () => {
    const h = holdMetrics(holdMetrics(null, talk({ raw: null }), 0), { ...pause(), raw: null }, 500)
    expect(h.raw).toBeNull()
    expect(h.fx.speechDb).toBe(-20)
  })
})
