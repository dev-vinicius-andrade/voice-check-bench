import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_GOAL } from '../types'
import { errorMsg } from './errors'
import { DesktopLiveFeed } from './liveFeed'
import { throttle, type ThrottleClock } from './throttle'
import { voiceFrames } from './testFrames'

describe('DesktopLiveFeed', () => {
  it('updates every 500 ms of audio, measures both sides with lag 0, holds and segments', () => {
    const feed = new DesktopLiveFeed()
    feed.reset()
    const updates = voiceFrames(6, 2).map((f) => feed.push(f, DEFAULT_GOAL)).filter((u) => u !== null)
    expect(updates.length).toBeGreaterThanOrEqual(10)
    const last = updates.at(-1)!
    expect(last.metrics.lagMs).toBe(0)
    expect(last.held.fx.speechDb - last.held.raw!.speechDb).toBeCloseTo(6.02, 0)
    expect(last.history.points.length).toBe(updates.length)
    feed.markChange({ key: 'desktop.advice.change.on', params: { plugin: 'ReaGate' } })
    expect(feed.nowMs).toBe(6000)
    expect(feed.report(DEFAULT_GOAL).segments).toHaveLength(2)
  })
})

describe('throttle', () => {
  it('sends at most once per interval and always the latest value; flush sends what is kept', () => {
    let now = 0
    const timers: (() => void)[] = []
    const clock: ThrottleClock = { now: () => now, setTimer: (fn) => timers.push(fn), clearTimer: vi.fn() }
    const sent: number[] = []
    const t = throttle((v: number) => sent.push(v), 50, clock)
    t.push(1)
    t.push(2)
    t.push(3)
    expect(sent).toEqual([1])
    now = 50
    timers.shift()!()
    expect(sent).toEqual([1, 3])
    now = 60
    t.push(4)
    t.flush()
    expect(sent).toEqual([1, 3, 4])
    t.flush()
    expect(sent).toEqual([1, 3, 4])
  })
})

describe('errorMsg', () => {
  it('maps engine codes to plain keys', () => {
    expect(errorMsg({ code: 'closeTimeout', message: 'x' })).toEqual({ key: 'desktop.errors.closeTimeout' })
    expect(errorMsg({ code: 'noDevice', message: 'x' })).toEqual({ key: 'desktop.errors.noDevice' })
    expect(errorMsg(new Error('boom'))).toEqual({ key: 'desktop.errors.other', params: { message: 'boom' } })
  })
})
