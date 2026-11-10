import { describe, expect, it } from 'vitest'
import { FloatRing } from './ring'

const seq = (from: number, n: number): Float32Array => Float32Array.from({ length: n }, (_, i) => from + i)

describe('FloatRing', () => {
  it('reads the last N samples oldest first', () => {
    const r = new FloatRing(8)
    r.write(seq(0, 5))
    const dst = new Float32Array(3)
    expect(r.readLast(dst)).toBe(true)
    expect(Array.from(dst)).toEqual([2, 3, 4])
    expect(r.length).toBe(5)
    expect(r.end).toBe(5)
    expect(r.start).toBe(0)
  })

  it('wraps around and keeps only the newest capacity samples', () => {
    const r = new FloatRing(8)
    r.write(seq(0, 6))
    r.write(seq(6, 6))
    const dst = new Float32Array(8)
    expect(r.readLast(dst)).toBe(true)
    expect(Array.from(dst)).toEqual([4, 5, 6, 7, 8, 9, 10, 11])
    expect(r.length).toBe(8)
    expect(r.start).toBe(4)
  })

  it('keeps the tail of a chunk longer than the ring', () => {
    const r = new FloatRing(4)
    r.write(seq(0, 10))
    const dst = new Float32Array(4)
    expect(r.readLast(dst)).toBe(true)
    expect(Array.from(dst)).toEqual([6, 7, 8, 9])
    expect(r.end).toBe(10)
  })

  it('refuses to read more than it holds', () => {
    const r = new FloatRing(8)
    r.write(seq(0, 3))
    const dst = new Float32Array(4).fill(-1)
    expect(r.readLast(dst)).toBe(false)
    expect(Array.from(dst)).toEqual([-1, -1, -1, -1])
  })

  it('addresses samples by absolute frame', () => {
    const r = new FloatRing(16)
    r.write(seq(100, 4), 100)
    r.write(seq(104, 4), 104)
    expect(r.start).toBe(100)
    expect(r.end).toBe(108)
    const dst = new Float32Array(3)
    expect(r.readEnding(dst, 106)).toBe(true)
    expect(Array.from(dst)).toEqual([103, 104, 105])
    expect(r.readEnding(dst, 109)).toBe(false)
    expect(r.readEnding(dst, 102)).toBe(false)
  })

  it('starts over on a gap so it never holds made-up samples', () => {
    const r = new FloatRing(16)
    r.write(seq(0, 4), 0)
    r.write(seq(10, 4), 10)
    expect(r.start).toBe(10)
    expect(r.length).toBe(4)
    const dst = new Float32Array(4)
    expect(r.readLast(dst)).toBe(true)
    expect(Array.from(dst)).toEqual([10, 11, 12, 13])
  })

  it('reads by frame across the wrap point', () => {
    const r = new FloatRing(5)
    for (let f = 0; f < 20; f += 3) r.write(seq(f, 3), f)
    // holds frames 16..20
    expect(r.start).toBe(16)
    const dst = new Float32Array(4)
    expect(r.readEnding(dst, 21)).toBe(true)
    expect(Array.from(dst)).toEqual([17, 18, 19, 20])
    expect(r.readEnding(dst, 20)).toBe(true)
    expect(Array.from(dst)).toEqual([16, 17, 18, 19])
  })

  it('clears', () => {
    const r = new FloatRing(4)
    r.write(seq(0, 4))
    r.clear()
    expect(r.length).toBe(0)
    expect(r.readLast(new Float32Array(1))).toBe(false)
  })
})
