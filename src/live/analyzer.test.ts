import { describe, expect, it } from 'vitest'
import { DEFAULT_GOAL } from '../types'
import { LiveAnalyzer } from './analyzer'
import { rawAndFx, voiceLike } from './liveTestSignals'
import { FloatRing } from './ring'
import { smoothMetrics } from './smooth'
import { LIVE_BUFFER_SEC } from './types'

const SR = 48000
const CHUNK = 1024

/** Writes x into a ring in tap-sized chunks stamped from `frame`. */
function fill(x: Float32Array, frame: number): FloatRing {
  const r = new FloatRing(LIVE_BUFFER_SEC * SR)
  for (let i = 0; i + CHUNK <= x.length; i += CHUNK) r.write(x.subarray(i, i + CHUNK), frame + i)
  return r
}

const source = voiceLike({ sec: 7, seed: 31, speechDb: -26, noiseDb: -58 })
const { raw, fx } = rawAndFx(source, 6.5 * SR, { delayMs: 30, gainDb: 6, gateDb: -48 })

describe('LiveAnalyzer', () => {
  it('waits for enough audio on both inputs', () => {
    const a = new LiveAnalyzer()
    const rawRing = fill(raw.subarray(0, 20 * CHUNK), 0)
    expect(a.update(rawRing, new FloatRing(SR), SR, DEFAULT_GOAL)).toBeNull()
  })

  it('lines up both inputs over the same frames, measures and hints', () => {
    const a = new LiveAnalyzer()
    // the Wave Link output was opened later: its ring starts 10 chunks after the raw one
    const late = 10 * CHUNK
    const rawRing = fill(raw, 5000)
    const fxRing = fill(fx.subarray(late), 5000 + late)
    const m = a.update(rawRing, fxRing, SR, DEFAULT_GOAL)
    expect(m).not.toBeNull()
    expect(m!.lagMs).not.toBeNull()
    expect(Math.abs(m!.lagMs! - 30)).toBeLessThan(5)
    expect(m!.sync).toBeGreaterThan(0.8)
    expect(m!.talkSec).toBeGreaterThan(1.5)
    expect(m!.raw).not.toBeNull()
    expect(Math.abs(m!.fx.speechDb - m!.raw!.speechDb - 6)).toBeLessThan(1)
    expect(m!.fx.deadSilence).toBeGreaterThan(0.05)
    expect(m!.hints.map((h) => h.key)).toContain('live.hint.deadSilence')
    expect(m!.hints.length).toBeLessThanOrEqual(4)
  })

  it('runs on the Wave Link output alone', () => {
    const a = new LiveAnalyzer()
    const m = a.update(null, fill(fx, 0), SR, DEFAULT_GOAL)
    expect(m).not.toBeNull()
    expect(m!.raw).toBeNull()
    expect(m!.lagMs).toBeNull()
    expect(m!.sync).toBe(0)
    expect(m!.talkSec).toBeGreaterThan(1.5)
  })

  it('smooths repeated updates and forgets them on reset', () => {
    const a = new LiveAnalyzer()
    const rawRing = fill(raw, 0)
    const fxRing = fill(fx, 0)
    const first = a.update(rawRing, fxRing, SR, DEFAULT_GOAL)!
    const second = a.update(rawRing, fxRing, SR, DEFAULT_GOAL)!
    expect(second.fx.speechDb).toBeCloseTo(first.fx.speechDb, 6)
    a.reset()
    expect(a.update(rawRing, fxRing, SR, DEFAULT_GOAL)!.lagMs).toBeCloseTo(first.lagMs!, 6)
  })
})

describe('smoothMetrics', () => {
  const side = (speechDb: number, pauseDb: number, peakDb: number) => ({ speechDb, pauseDb, peakDb, clipFrames: 0, deadSilence: 0, tone: [0, 1, NaN] })
  it('averages speech, pauses and tone; keeps peaks and talk time as measured; NaN restarts', () => {
    const prev = { talkSec: 2, raw: null, fx: side(-20, -60, -3) }
    const next = { talkSec: 3, raw: null, fx: { ...side(-30, NaN, -10), tone: [10, 1, 4] } }
    const s = smoothMetrics(prev, next)
    expect(s.talkSec).toBe(3)
    expect(s.fx.speechDb).toBeCloseTo(-24, 9)
    expect(s.fx.pauseDb).toBeNaN()
    expect(s.fx.peakDb).toBe(-10)
    expect(s.fx.tone).toEqual([4, 1, 4])
    expect(smoothMetrics(null, next)).toEqual(next)
  })
})
