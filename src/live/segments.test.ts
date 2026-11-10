import { describe, expect, it } from 'vitest'
import { digitalSilence } from '../audio/analyze'
import { DEFAULT_GOAL } from '../types'
import { frameLen, liveFrames, ZeroRuns } from './frames'
import { rawAndFx, voiceLike } from './liveTestSignals'
import { computeLiveMetrics } from './metrics'
import { LiveSegments, MAX_SEGMENTS, START_LABEL } from './segments'
import { LIVE_UPDATE_MS, LIVE_WINDOW_SEC } from './types'

const SR = 48000
const STEP = (LIVE_UPDATE_MS / 1000) * SR
const WIN = LIVE_WINDOW_SEC * SR

/** Feeds raw/fx (same length, fx `lagMs` behind raw) to `segs` as the live engine does: a 4 s window every 500 ms. */
function feedLive(segs: LiveSegments, raw: Float32Array | null, fx: Float32Array, lagMs: number | null, from = 0, to = fx.length): void {
  const lag = Math.round(((lagMs ?? 0) * SR) / 1000)
  for (let e = from + STEP; e <= to; e += STEP) {
    const s = Math.max(0, e - WIN)
    const rawWin = raw ? raw.subarray(Math.max(0, s - lag), e) : null
    segs.feed(liveFrames(rawWin, fx.subarray(s, e), SR, lagMs), e, (e / SR) * 1000)
  }
}

describe('ZeroRuns', () => {
  it('matches digitalSilence over a stream fed in pieces, runs spanning pieces included', () => {
    const x = new Float32Array(SR)
    for (let i = 0; i < x.length; i++) x[i] = Math.sin(i / 7) * 0.1
    x.fill(0, 1000, 1300) // 6.25 ms: too short
    x.fill(0, 4700, 5600) // spans the 4800 piece boundary
    x.fill(0, 20000, 30000)
    const z = new ZeroRuns(SR)
    for (let i = 0; i < x.length; i += 4800) z.push(x.subarray(i, i + 4800))
    expect(z.ratio).toBeCloseTo(digitalSilence(x, SR).zeroRatio, 12)
    expect(z.ratio).toBeCloseTo(10900 / SR, 12)
  })
})

describe('LiveSegments', () => {
  it('overlapping windows are counted once: the same numbers as one pass over the whole 10 s', () => {
    const sig = voiceLike({ sec: 10, seed: 13, speechDb: -24, noiseDb: -60 })
    const segs = new LiveSegments()
    feedLive(segs, null, sig, null)
    const all = segs.sinceStart(DEFAULT_GOAL)
    const once = computeLiveMetrics(null, sig, SR, null, DEFAULT_GOAL)
    expect(once.talkSec).toBeGreaterThan(5)
    expect(Math.abs(all.talkSec - once.talkSec)).toBeLessThanOrEqual(0.1)
    expect(Math.abs(all.fx.speechDb - once.fx.speechDb)).toBeLessThan(0.5)
    expect(Math.abs(all.fx.pauseDb - once.fx.pauseDb)).toBeLessThan(0.5)
    expect(all.fx.clipFrames).toBe(0)
    expect(all.raw).toBeNull()
    for (const b of [1, 2, 3, 4, 5, 6, 7]) expect(Math.abs(all.fx.tone[b] - once.fx.tone[b])).toBeLessThan(1.5)
    expect(all.startT).toBe(0)
    expect(all.endT).toBe(10_000)
    // a repeated window adds nothing
    segs.feed(liveFrames(null, sig.subarray(sig.length - WIN), SR, null), sig.length, 10_500)
    expect(segs.sinceStart(DEFAULT_GOAL).talkSec).toBe(all.talkSec)
  })

  it('raw and delayed, gated fx: both sides match one pass, dead silence included', () => {
    const source = voiceLike({ sec: 10.1, seed: 17, speechDb: -26, noiseDb: -58 })
    const { raw, fx } = rawAndFx(source, 10 * SR, { delayMs: 30, gainDb: 6, gateDb: -48 })
    const segs = new LiveSegments()
    feedLive(segs, raw, fx, 30)
    const all = segs.sinceStart(DEFAULT_GOAL)
    const once = computeLiveMetrics(raw, fx, SR, 30, DEFAULT_GOAL)
    expect(Math.abs(all.talkSec - once.talkSec)).toBeLessThanOrEqual(0.1)
    expect(Math.abs(all.raw!.speechDb - once.raw!.speechDb)).toBeLessThan(0.5)
    expect(Math.abs(all.fx.speechDb - once.fx.speechDb)).toBeLessThan(0.5)
    expect(all.fx.deadSilence).toBeGreaterThan(0.05)
    expect(Math.abs(all.fx.deadSilence - once.fx.deadSilence)).toBeLessThan(0.01)
    expect(all.raw!.deadSilence).toBe(0)
  })

  it('counts clipped frames once', () => {
    const hot = voiceLike({ sec: 6, seed: 19 }).map((v) => v * 30)
    const segs = new LiveSegments()
    feedLive(segs, null, hot, null)
    const once = computeLiveMetrics(null, hot, SR, null, DEFAULT_GOAL)
    expect(once.fx.clipFrames).toBeGreaterThan(0)
    expect(segs.sinceStart(DEFAULT_GOAL).fx.clipFrames).toBe(once.fx.clipFrames)
  })

  it('markChange splits: segments add up to the whole, with labels and times', () => {
    const sig = voiceLike({ sec: 10, seed: 23 })
    const segs = new LiveSegments()
    feedLive(segs, null, sig, null, 0, 5 * SR)
    segs.markChange({ key: 'live.change.eq' }, 5000)
    feedLive(segs, null, sig, null, 5 * SR)
    const [a, b] = segs.segments(DEFAULT_GOAL)
    const all = segs.sinceStart(DEFAULT_GOAL)
    expect(segs.segments(DEFAULT_GOAL)).toHaveLength(2)
    expect(a.label).toEqual(START_LABEL)
    expect(b.label).toEqual({ key: 'live.change.eq' })
    expect([a.startT, a.endT, b.startT, b.endT]).toEqual([0, 5000, 5000, 10_000])
    expect(a.talkSec + b.talkSec).toBeCloseTo(all.talkSec, 9)
    expect(a.talkSec).toBeGreaterThan(2)
    expect(b.talkSec).toBeGreaterThan(2)
    expect(Number.isFinite(a.fx.speechDb) && Number.isFinite(b.fx.speechDb)).toBe(true)
  })

  it('a short segment leaves tone and pauses unmeasured', () => {
    const segs = new LiveSegments()
    segs.markChange({ key: 'x' }, 0)
    const s = segs.segments(DEFAULT_GOAL).at(-1)!
    expect(s.talkSec).toBe(0)
    expect(s.fx.speechDb).toBeNaN()
    expect(s.fx.pauseDb).toBeNaN()
    expect(s.fx.tone.every(Number.isNaN)).toBe(true)
  })

  it('memory stays bounded however long it runs', () => {
    const block = voiceLike({ sec: LIVE_WINDOW_SEC, seed: 29 })
    const frames = liveFrames(null, block, SR, null)
    const segs = new LiveSegments()
    let end = 0
    const run = (n: number): void => {
      for (let k = 0; k < n; k++) segs.feed(frames, (end += block.length), end / 48)
    }
    run(10)
    const before = segs.footprint()
    run(300) // 20 minutes of audio
    expect(segs.footprint()).toEqual(before)
    expect(segs.sinceStart(DEFAULT_GOAL).talkSec).toBeGreaterThan(600)
    for (let k = 0; k < MAX_SEGMENTS + 50; k++) segs.markChange({ key: 'x' }, end / 48 + k)
    expect(segs.footprint().closed).toBe(MAX_SEGMENTS)
    expect(segs.segments(DEFAULT_GOAL)).toHaveLength(MAX_SEGMENTS + 1)
  })

  it('reset forgets everything', () => {
    const segs = new LiveSegments()
    feedLive(segs, null, voiceLike({ sec: 3, seed: 31 }), null)
    segs.markChange({ key: 'x' }, 3000)
    segs.reset(100)
    expect(segs.segments(DEFAULT_GOAL)).toHaveLength(1)
    expect(segs.sinceStart(DEFAULT_GOAL).talkSec).toBe(0)
    expect(segs.sinceStart(DEFAULT_GOAL).startT).toBe(100)
    // a new stream may start at sample 0 again
    feedLive(segs, null, voiceLike({ sec: 2, seed: 31 }), null)
    expect(segs.sinceStart(DEFAULT_GOAL).talkSec).toBeGreaterThan(0.5)
    expect(frameLen(SR)).toBe(2400)
  })
})
