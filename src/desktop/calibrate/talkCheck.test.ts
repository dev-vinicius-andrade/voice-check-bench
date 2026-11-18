import { describe, expect, it } from 'vitest'
import { FrameCollector } from './levels'
import { talkCheck } from './talkCheck'
import { speech } from './testLive'

const SR = 48000
const ROOM = -37

function check(raw: Float32Array, proc: Float32Array, longPausesDb = -100, removerWorks = false) {
  const c = new FrameCollector(SR, true)
  c.push(raw, proc)
  const s = c.samples()
  return talkCheck(c.frames, s.raw, s.proc, SR, ROOM, longPausesDb, removerWorks)
}

/** Per 10 ms block: the block's gain from its raw level. */
function byBlock(raw: Float32Array, gain: (db: number) => number): Float32Array {
  const out = raw.slice()
  const w = 480
  for (let b = 0; b + w <= raw.length; b += w) {
    let s = 0
    for (let i = b; i < b + w; i++) s += raw[i] * raw[i]
    const g = gain(10 * Math.log10(s / w + 1e-20))
    for (let i = b; i < b + w; i++) out[i] *= g
  }
  return out
}

describe('live talk check', () => {
  const raw = speech(12, ROOM)

  it('a steady gain cuts nothing and is read as the gain', () => {
    const c = check(raw, raw.map((v) => v * 2))
    expect(c.cuts).toBe(false)
    expect(c.gainDb).toBeCloseTo(6, 0)
    expect(c.speechSec).toBeGreaterThan(3)
  })

  it('a remover that only takes the room (also under quiet syllables) does not read as cutting words', () => {
    const c = check(raw, byBlock(raw, (db) => (db < ROOM + 3 ? 0 : 1)), -100, true)
    expect(c.cuts).toBe(false)
    expect(c.cutEvents).toBeLessThanOrEqual(1)
  })

  it('word starts held down are cut', () => {
    // the quiet syllables (8 dB over the room) and the starts and tails of the loud ones are taken out
    const c = check(raw, byBlock(raw, (db) => (db < ROOM + 10 ? 0 : 1)), -100, true)
    expect(c.cuts).toBe(true)
    expect(c.cutEvents).toBeGreaterThan(1)
  })

  it('a gate turning an audible room down 20 dB in the pauses pumps it; 12 dB does not', () => {
    const gate = (floorDb: number) => byBlock(raw, (db) => (db > ROOM + 6 ? 1 : 10 ** (floorDb / 20)))
    expect(check(raw, gate(-20), ROOM - 20).pumps).toBe(true)
    const shallow = check(raw, gate(-12), ROOM - 12)
    expect(shallow.pumps).toBe(false)
    expect(shallow.pumpDb).toBeCloseTo(12, 0)
  })

  it('a remover that is silent between the words too does not pump', () => {
    const c = check(raw, byBlock(raw, (db) => (db < ROOM + 3 ? 0 : 1)), -100, true)
    expect(c.pausesDb).toBe(-100)
    expect(c.pumpDb).toBe(0)
  })

  it('measures the quietest speech a gate must open on (P10 of the quietest quarter peaks)', () => {
    const c = check(raw, raw)
    expect(c.quietPeakDb).toBeGreaterThan(ROOM + 10)
    expect(c.quietPeakDb).toBeLessThan(ROOM + 15 + 6)
  })
})
