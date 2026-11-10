import { describe, expect, it } from 'vitest'
import { EMPTY_HISTORY, HISTORY_MAX_POINTS, HISTORY_MS, markHistory, pushHistory } from './history'
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

describe('history', () => {
  it('one point per update, older than 60 s drops off', () => {
    let h = EMPTY_HISTORY
    for (let k = 0; k < 200; k++) h = pushHistory(h, k % 4 === 3 ? pause() : talk(), k * 500)
    expect(h.points).toHaveLength(HISTORY_MS / 500)
    expect(h.points[0].t).toBe(199 * 500 - HISTORY_MS + 500)
    const last = h.points.at(-1)!
    expect(last.t).toBe(199 * 500)
    expect(last.talking).toBe(false)
    expect(last.fxSpeechDb).toBeNaN()
    expect(last.fxPauseDb).toBe(-72)
    expect(last.rawPauseDb).toBe(-45)
    const talking = h.points.at(-2)!
    expect(talking.talking).toBe(true)
    expect(talking.fxSpeechDb).toBe(-20)
    expect(talking.rawSpeechDb).toBe(-26)
  })

  it('raw values are NaN without a raw mic', () => {
    const p = pushHistory(EMPTY_HISTORY, talk({ raw: null }), 0).points[0]
    expect(p.rawSpeechDb).toBeNaN()
    expect(p.rawPauseDb).toBeNaN()
  })

  it('markers sit at their time and drop off with the window', () => {
    let h = pushHistory(EMPTY_HISTORY, talk(), 0)
    h = markHistory(h, { key: 'x.a' }, 1000)
    h = pushHistory(h, talk(), 1500)
    h = markHistory(h, { key: 'x.b' }, 40_000)
    expect(h.markers.map((m) => m.label.key)).toEqual(['x.a', 'x.b'])
    h = pushHistory(h, talk(), 61_600)
    expect(h.markers).toEqual([{ t: 40_000, label: { key: 'x.b' } }])
    expect(h.points.map((p) => p.t)).toEqual([61_600])
  })

  it('stays bounded at any update rate', () => {
    let h = EMPTY_HISTORY
    for (let k = 0; k < 2000; k++) h = pushHistory(h, talk(), k * 10)
    expect(h.points).toHaveLength(HISTORY_MAX_POINTS)
  })

  it('does not change the history it was given', () => {
    const a = pushHistory(EMPTY_HISTORY, talk(), 0)
    pushHistory(a, talk(), 500)
    markHistory(a, { key: 'x' }, 600)
    expect(a.points).toHaveLength(1)
    expect(a.markers).toHaveLength(0)
  })
})
