// @vitest-environment node
// A steady narrow tone of the mic chain (a whistle) is not voice: its bins stay out of the tone measure, so the band
// holding it reads the voice alone, and a render with the whistle notched out reads that band as the one with it.
import { describe, expect, it } from 'vitest'
import { BANDS, QUIET_SEC } from '../../audio/reference'
import { bandsOfCells, measure, prepareTake, robustTone, TONE_CUT_BINS, type TakeMask } from './measure'
import { testTake } from './testTake'

const SR = 48000
/** Between two of the test voice's body sines (994 and 1169 Hz), in the body band (640 Hz–1.25 kHz). */
const WHISTLE_HZ = 1080
const BODY = 4
const clean = testTake({ speechDb: -21, noiseDb: -70 })
const cleanMask = prepareTake(clean) as TakeMask

/**
 * The clean take with a steady whistle (−28 dBFS RMS) over the lead and the speech, gone in the later pauses as on
 * the real take (there the pause spectrum cannot take it off the voice), with 10 ms ramps.
 */
function whistled(): Float32Array {
  const on = new Float32Array(clean.length).fill(1)
  for (const f of cleanMask.pause) if (f * cleanMask.win >= QUIET_SEC * SR) on.fill(0, f * cleanMask.win, (f + 1) * cleanMask.win)
  const ramp = Math.round(0.01 * SR)
  const amp = 10 ** (-28 / 20) * Math.SQRT2
  const out = clean.slice()
  let s = 0
  for (let i = 0; i < clean.length; i++) {
    s += on[i] - (i >= ramp ? on[i - ramp] : 0)
    out[i] += (amp * s * Math.sin((2 * Math.PI * WHISTLE_HZ * i) / SR)) / ramp
  }
  return out
}

/** A narrow notch (RBJ biquad, Q 30) at `hz`: what the person does by hand on the whistle. */
function notch(x: Float32Array, hz: number, q = 30): Float32Array {
  const w = (2 * Math.PI * hz) / SR
  const alpha = Math.sin(w) / (2 * q)
  const a0 = 1 + alpha
  const [b0, b1, b2, a1, a2] = [1 / a0, (-2 * Math.cos(w)) / a0, 1 / a0, (-2 * Math.cos(w)) / a0, (1 - alpha) / a0]
  const y = new Float32Array(x.length)
  let [x1, x2, y1, y2] = [0, 0, 0, 0]
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
    ;[x2, x1, y2, y1] = [x1, x[i], y1, v]
    y[i] = v
  }
  return y
}

const body = (mask: TakeMask, audio: Float32Array): number => robustTone(bandsOfCells(measure(mask, audio).cells), 'natural')[BODY]

describe('steady tones in the tone measure', () => {
  const take = whistled()
  const mask = prepareTake(take) as TakeMask

  it('finds the whistle of the raw take once and keeps it in the mask', () => {
    expect(mask.steadyHz.length).toBeGreaterThan(0)
    expect(Math.abs(mask.steadyHz[0] - WHISTLE_HZ)).toBeLessThan(1)
    expect(mask.cellFill).not.toBeNull()
    // the whistle's bins belong to no cell, the bins next to them still do
    const k = Math.round((WHISTLE_HZ * 8192) / SR)
    for (let d = -TONE_CUT_BINS; d <= TONE_CUT_BINS; d++) expect(mask.binCell[k + d]).toBe(-1)
    expect(mask.binCell[k - TONE_CUT_BINS - 1]).toBeGreaterThanOrEqual(0)
    expect(mask.binCell[k + TONE_CUT_BINS + 1]).toBeGreaterThanOrEqual(0)
    expect(mask.masked[BODY]).toBe(false)
  })

  it('counted in, the whistle would move the body band', () => {
    // the same take measured with every bin (no tone left out): the whistle reads as voice
    const all: TakeMask = { ...mask, binCell: cleanMask.binCell, cellFill: null }
    expect(body(all, take) - body(cleanMask, clean)).toBeGreaterThan(3)
  })

  it('reads the body band as the same take without the whistle does', () => {
    expect(body(mask, take)).toBeCloseTo(body(cleanMask, clean), 0)
    expect(Math.abs(body(mask, take) - body(cleanMask, clean))).toBeLessThan(0.5)
    // and every other band too
    const a = robustTone(bandsOfCells(measure(mask, take).cells), 'natural')
    const b = robustTone(bandsOfCells(measure(cleanMask, clean).cells), 'natural')
    a.forEach((v, i) => expect(Math.abs(v - b[i]), BANDS[i].name).toBeLessThan(0.5))
  })

  it('a render with the whistle notched out reads the body band as the render with it', () => {
    const cut = notch(take, WHISTLE_HZ)
    expect(Math.abs(body(mask, cut) - body(mask, take))).toBeLessThan(0.5)
    // the whistle removed altogether (the clean take) too: same bins, same reading
    expect(Math.abs(body(mask, clean) - body(mask, take))).toBeLessThan(0.5)
  })

  it('a take without steady tones keeps every bin: nothing changes', () => {
    expect(cleanMask.steadyHz).toEqual([])
    expect(cleanMask.cellFill).toBeNull()
    // every bin of every band belongs to a cell, as the band sums of analyze() count them
    const binHz = SR / 8192
    for (const b of BANDS) for (let i = Math.ceil(b.lo / binHz); i < b.hi / binHz; i++) expect(cleanMask.binCell[i]).toBeGreaterThanOrEqual(0)
  })
})
