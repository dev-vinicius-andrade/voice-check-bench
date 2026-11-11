import { describe, expect, it } from 'vitest'
import { LIVE_WINDOW_SEC } from '../../live/types'
import { held, tone } from './testFixtures'
import { emptyTrend, pushTrend, STABLE_SPAN_MS, TREND_KEEP_MS, trendTone, type ToneTrend } from './trend'

/** Pushes one window per second from `startMs`, presence (index 6) taking the given values in turn. */
function feed(values: readonly number[], startMs = 1000, notBeforeMs?: number, from: ToneTrend = emptyTrend(notBeforeMs)): ToneTrend {
  return values.reduce((t, v, i) => pushTrend(t, held({ heardAtMs: startMs + i * 1000, tone: tone({ 6: v }) }), notBeforeMs), from)
}

const presence = (t: ToneTrend): number => trendTone(t).tone[6]

describe('tone trend: what goes in', () => {
  it('skips windows not heard, heard before notBeforeMs, or already in', () => {
    let t = emptyTrend(5000)
    t = pushTrend(t, held({ heardAtMs: null, heardAgoMs: null }), 5000)
    t = pushTrend(t, held({ heardAtMs: 4000 }), 5000)
    expect(t.entries).toEqual([])
    t = pushTrend(t, held({ heardAtMs: 5000 }), 5000)
    t = pushTrend(t, held({ heardAtMs: 5000, heardAgoMs: 900 }), 5000)
    expect(t.entries.map((e) => e.atMs)).toEqual([5000])
  })

  it('starts over when notBeforeMs changes (a change was applied) or the clock goes back (restart)', () => {
    const t = feed([3, 3, 3])
    expect(t.entries).toHaveLength(3)
    expect(pushTrend(t, held({ heardAtMs: 9000 }), 8000)).toEqual({ since: 8000, entries: [{ atMs: 9000, tone: tone({}) }] })
    expect(pushTrend(t, held({ heardAtMs: 9000 }), 10_000)).toEqual({ since: 10_000, entries: [] })
    expect(pushTrend(t, held({ heardAtMs: 500 })).entries.map((e) => e.atMs)).toEqual([500])
  })

  it('keeps only the last TREND_KEEP_MS', () => {
    const t = feed(Array.from({ length: 40 }, () => 3))
    const at = t.entries.map((e) => e.atMs)
    expect(at[0]).toBe(at.at(-1)! - TREND_KEEP_MS)
    expect(at).toHaveLength(31)
  })
})

describe('tone trend: when a band counts', () => {
  it('nothing until the windows span STABLE_SPAN_MS (~15 s of audio), then the median', () => {
    expect(trendTone(emptyTrend())).toEqual({ tone: [], evidenceSec: 0 })
    const short = feed(Array.from({ length: 11 }, () => 3)) // spans 10 s
    expect(presence(short)).toBeNaN()
    const enough = feed([3, 2, 4, 3, 5, 3, 2, 4, 3, 3, 3, 4]) // spans 11 s
    expect(STABLE_SPAN_MS).toBe(11_000)
    expect(presence(enough)).toBe(3)
    expect(trendTone(enough).evidenceSec).toBe(11 + LIVE_WINDOW_SEC)
  })

  it('a band that flips sign is not stable; one stray window in ten is fine', () => {
    expect(presence(feed([4, -3, 5, -2, 6, -4, 3, -1, 2, 5, -3, 4]))).toBeNaN()
    expect(presence(feed([4, 3, 5, 4, -2, 4, 3, 5, 4, 4, 3, 4]))).toBe(4)
  })

  it('needs 8 finite readings', () => {
    const gaps = feed([3, NaN, NaN, 3, NaN, 3, 3, NaN, 3, 3, 3, 3]) // 8 finite → stable
    expect(presence(gaps)).toBe(3)
    const few = feed([3, NaN, NaN, 3, NaN, 3, NaN, NaN, 3, 3, 3, 3]) // 7 finite
    expect(presence(few)).toBeNaN()
  })

  it('every band on its own, same indexing as held.fx.tone', () => {
    const t = feed(Array.from({ length: 12 }, () => 3))
    const out = trendTone(t).tone
    expect(out).toHaveLength(9)
    // the other bands read 0: stable at 0, which tone advice skips
    expect(out[1]).toBe(0)
    expect(out[6]).toBe(3)
  })
})
