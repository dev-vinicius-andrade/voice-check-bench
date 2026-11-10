import { describe, expect, it } from 'vitest'
import { FLOOR_DB } from '../audio/analyze'
import { STYLE_OFFSETS } from '../audio/reference'
import { DEFAULT_GOAL } from '../types'
import { estimateLag } from './align'
import { rawAndFx, voiceLike } from './liveTestSignals'
import { computeLiveMetrics } from './metrics'
import { LIVE_WINDOW_SEC } from './types'

const SR = 48000
const W = LIVE_WINDOW_SEC * SR
const source = voiceLike({ sec: 5, seed: 21, speechDb: -24, noiseDb: -60 })
/** Raw longer than fx by the delay, both ending at the same instant, as the session reads them. */
function windows(delayMs: number, fxOpts: Parameters<typeof rawAndFx>[2] = {}): { raw: Float32Array; fx: Float32Array } {
  const d = Math.round((delayMs * SR) / 1000)
  const { fx } = rawAndFx(source, W, { delayMs, ...fxOpts })
  return { raw: source.slice(source.length - W - d), fx }
}

describe('computeLiveMetrics', () => {
  const { raw, fx } = windows(30, { gainDb: 6, gateDb: -50 })
  const m = computeLiveMetrics(raw, fx, SR, 30, DEFAULT_GOAL)

  it('measures talk, level and pauses of the raw mic', () => {
    expect(m.talkSec).toBeGreaterThan(2)
    expect(m.talkSec).toBeLessThan(3.6)
    expect(m.raw).not.toBeNull()
    const r = m.raw!
    expect(Math.abs(r.speechDb - -25)).toBeLessThan(3)
    expect(Math.abs(r.pauseDb - -60)).toBeLessThan(2)
    expect(r.deadSilence).toBe(0)
    expect(r.clipFrames).toBe(0)
    expect(r.tone).toHaveLength(9)
    expect(r.tone.every(Number.isFinite)).toBe(true)
  })

  it('a silent raw input (wrong device) falls back to talk from the Wave Link output', () => {
    const silent = new Float32Array(raw.length)
    const s = computeLiveMetrics(silent, fx, SR, 30, DEFAULT_GOAL)
    expect(s.talkSec).toBeGreaterThan(2)
    expect(s.raw!.peakDb).toBeLessThan(-60)
    expect(s.fx.tone.every(Number.isFinite)).toBe(true)
  })

  it('measures the same frames on the delayed, louder, gated output', () => {
    expect(m.fx.speechDb - m.raw!.speechDb).toBeGreaterThan(5)
    expect(m.fx.speechDb - m.raw!.speechDb).toBeLessThan(7)
    // the gate leaves exact zeros in every pause
    expect(m.fx.pauseDb).toBe(FLOOR_DB)
    expect(m.fx.deadSilence).toBeGreaterThan(0.05)
    // gain and a gate do not change the tone of the talk frames
    for (const i of [1, 2, 3, 4, 5, 6]) expect(Math.abs(m.fx.tone[i] - m.raw!.tone[i])).toBeLessThan(1.5)
  })

  it('lines the frames up by the lag', () => {
    const w = windows(300, { gateDb: -50 })
    const right = computeLiveMetrics(w.raw, w.fx, SR, 300, DEFAULT_GOAL)
    const wrong = computeLiveMetrics(w.raw, w.fx, SR, 0, DEFAULT_GOAL)
    expect(right.fx.pauseDb).toBe(FLOOR_DB)
    expect(wrong.fx.pauseDb).toBeGreaterThan(-80)
    expect(Math.abs(right.fx.speechDb - right.raw!.speechDb)).toBeLessThan(1)
  })

  it('analyses the overlap when both windows have the same length', () => {
    const { raw: r, fx: f } = rawAndFx(source, W, { delayMs: 30, gainDb: 6, gateDb: -50 })
    const lag = estimateLag(r, f, SR).lagMs
    const same = computeLiveMetrics(r, f, SR, lag, DEFAULT_GOAL)
    expect(Math.abs(same.fx.speechDb - same.raw!.speechDb - 6)).toBeLessThan(1)
    expect(same.fx.pauseDb).toBe(FLOOR_DB)
  })

  it('classifies on the output itself without a raw mic', () => {
    const only = computeLiveMetrics(null, fx, SR, null, DEFAULT_GOAL)
    expect(only.raw).toBeNull()
    expect(Math.abs(only.talkSec - m.talkSec)).toBeLessThan(0.4)
    expect(Math.abs(only.fx.speechDb - m.fx.speechDb)).toBeLessThan(1)
    expect(only.fx.pauseDb).toBe(FLOOR_DB)
  })

  it('counts clipped frames and the peak', () => {
    const hot = source.map((v) => v * 30)
    const r = computeLiveMetrics(null, hot.slice(hot.length - W), SR, null, DEFAULT_GOAL)
    expect(r.fx.clipFrames).toBeGreaterThan(0)
    expect(r.fx.peakDb).toBeGreaterThanOrEqual(-1)
    expect(m.fx.peakDb).toBeLessThan(-1)
  })

  it('leaves tone unmeasured and reads the room when nobody talks', () => {
    const room = voiceLike({ sec: 4, seed: 3, noiseDb: -58, leadSec: 99 })
    const r = computeLiveMetrics(room, room, SR, 0, DEFAULT_GOAL)
    expect(r.talkSec).toBeLessThan(1)
    expect(r.fx.tone.every(Number.isNaN)).toBe(true)
    expect(Math.abs(r.fx.pauseDb - -58)).toBeLessThan(2)
  })

  it('reads all-zero input as dead silence at the floor', () => {
    const r = computeLiveMetrics(null, new Float32Array(W), SR, null, DEFAULT_GOAL)
    expect(r.talkSec).toBe(0)
    expect(r.fx.deadSilence).toBe(1)
    expect(r.fx.peakDb).toBe(FLOOR_DB)
    expect(r.fx.pauseDb).toBe(FLOOR_DB)
    expect(Number.isNaN(r.fx.speechDb)).toBe(true)
  })

  it('sees a presence boost on the output and judges tone against the goal', () => {
    const boosted = fx.slice()
    // a 3.5 kHz component wherever the gate is open (while talking)
    for (let i = 0; i < boosted.length; i++) if (boosted[i] !== 0) boosted[i] += 0.05 * Math.sin((2 * Math.PI * 3500 * i) / SR)
    const b = computeLiveMetrics(raw, boosted, SR, 30, DEFAULT_GOAL)
    expect(b.fx.tone[6] - b.raw!.tone[6]).toBeGreaterThan(3)
    const clear = computeLiveMetrics(raw, fx, SR, 30, { style: 'clear', perceived: [] })
    clear.raw!.tone.forEach((v, i) => expect(v).toBeCloseTo(m.raw!.tone[i] - STYLE_OFFSETS.clear[i], 6))
  })

  it('runs fast enough for a 500 ms update (2 × 4 s at 48 kHz, plus alignment over 6 s)', () => {
    const big = voiceLike({ sec: 7, seed: 5 })
    const a = rawAndFx(big, 6 * SR, { delayMs: 40, gainDb: 6, gateDb: -50 })
    const times: number[] = []
    const alignTimes: number[] = []
    for (let k = 0; k < 15; k++) {
      const t0 = performance.now()
      estimateLag(a.raw, a.fx, SR)
      const t1 = performance.now()
      computeLiveMetrics(raw, fx, SR, 30, DEFAULT_GOAL)
      times.push(performance.now() - t1)
      alignTimes.push(t1 - t0)
    }
    const med = (v: number[]): number => v.slice().sort((x, y) => x - y)[Math.floor(v.length / 2)]
    console.info(`live metrics: median ${med(times).toFixed(2)} ms (min ${Math.min(...times).toFixed(2)}); alignment over 6 s: median ${med(alignTimes).toFixed(2)} ms`)
    // best run = the code's own cost; the median also carries whatever else the machine is doing (parallel test files)
    expect(Math.min(...times)).toBeLessThan(15)
  })
})
