import { describe, expect, it } from 'vitest'
import { prng } from '../audio/testSignals'
import { estimateLag, LagTracker, LAG_HISTORY, SYNC_CONFIDENT } from './align'
import { rawAndFx, voiceLike } from './liveTestSignals'

const SR = 48000
const LEN = 6 * SR
const source = voiceLike({ sec: 6.6, seed: 11, noiseDb: -62 })

describe('estimateLag', () => {
  it('finds a 30 ms delay of a plain copy', () => {
    const { raw, fx } = rawAndFx(source, LEN, { delayMs: 30 })
    const e = estimateLag(raw, fx, SR)
    expect(e.lagMs).toBeGreaterThan(27)
    expect(e.lagMs).toBeLessThan(33)
    expect(e.sync).toBeGreaterThan(0.9)
  })

  it('finds the delay of a louder, filtered and gated copy', () => {
    const { raw, fx } = rawAndFx(source, LEN, { delayMs: 120, gainDb: 8, lowpassHz: 3000, gateDb: -50 })
    const e = estimateLag(raw, fx, SR)
    expect(Math.abs(e.lagMs - 120)).toBeLessThan(6)
    expect(e.sync).toBeGreaterThan(0.7)
  })

  it('resolves a delay between envelope frames', () => {
    const { raw, fx } = rawAndFx(source, LEN, { delayMs: 37, gainDb: -4, addNoiseDb: -58 })
    const e = estimateLag(raw, fx, SR)
    expect(Math.abs(e.lagMs - 37)).toBeLessThan(6)
  })

  it('reads ~0 for no delay and a small negative lag when fx is slightly ahead', () => {
    const same = rawAndFx(source, LEN, { delayMs: 0, gainDb: 3 })
    expect(Math.abs(estimateLag(same.raw, same.fx, SR).lagMs)).toBeLessThan(3)
    // fx ahead by 10 ms: swap the roles of a 10 ms delayed copy
    const ahead = rawAndFx(source, LEN, { delayMs: 10 })
    const e = estimateLag(ahead.fx, ahead.raw, SR)
    expect(e.lagMs).toBeLessThan(-6)
    expect(e.lagMs).toBeGreaterThan(-14)
  })

  it('finds delays up to the search limit', () => {
    const { raw, fx } = rawAndFx(source, LEN, { delayMs: 450, gainDb: 6 })
    expect(Math.abs(estimateLag(raw, fx, SR).lagMs - 450)).toBeLessThan(6)
  })

  it('does not trust two unrelated voices (phrase rhythms can still correlate a little)', () => {
    const other = voiceLike({ sec: 6, seed: 999, noiseDb: -55 })
    const e = estimateLag(source.slice(0, LEN), other, SR)
    expect(e.sync).toBeLessThan(SYNC_CONFIDENT)
  })

  it('reports no sync against digital silence or white noise', () => {
    const raw = source.slice(0, LEN)
    expect(estimateLag(raw, new Float32Array(LEN), SR)).toEqual({ lagMs: 0, sync: 0 })
    const rnd = prng(5)
    const noise = Float32Array.from({ length: LEN }, () => (rnd() * 2 - 1) * 0.01)
    expect(estimateLag(raw, noise, SR).sync).toBeLessThan(0.3)
  })
})

describe('LagTracker', () => {
  it('is null until the first confident estimate', () => {
    const t = new LagTracker()
    expect(t.push({ lagMs: 40, sync: 0.3 })).toBeNull()
    expect(t.push({ lagMs: 40, sync: 0.5 })).toBe(40)
  })

  it('takes the median of the last confident estimates and ignores weak ones', () => {
    const t = new LagTracker()
    for (const lag of [30, 32, 300, 31, 29]) t.push({ lagMs: lag, sync: 0.8 })
    expect(t.lagMs).toBe(31)
    t.push({ lagMs: 400, sync: 0.2 })
    expect(t.lagMs).toBe(31)
    // after LAG_HISTORY new estimates the old ones are gone
    for (let i = 0; i < LAG_HISTORY; i++) t.push({ lagMs: 80, sync: 0.9 })
    expect(t.lagMs).toBe(80)
    t.reset()
    expect(t.lagMs).toBeNull()
  })
})
