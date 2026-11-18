// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { isNotch } from '../../settings/suggest'
import { eqKey, withChange } from '../advice/chain'
import { eq, GUIDE_BANDS } from '../advice/testFixtures'
import type { ChainSlot } from '../advice/types'
import { eqHandles } from '../tune/eqModel'
import { EQ_LIMITS, eqCurveDb, eqPointsOf, notchPlan } from './eqCurve'
import type { EqPoint, NotchPlan, SpectrumTone } from './types'

const pt = (n: number, p: Partial<EqPoint>): EqPoint => ({ n, type: 'Band', on: true, freqHz: 1000, gainDb: 0, bwOct: 1, ...p })
const at = (points: EqPoint[], ...hz: number[]): number[] => Array.from(eqCurveDb(points, Float32Array.from(hz)))
const tone = (freqHz: number, overDb = 20): SpectrumTone => ({ freqHz, overDb, levelDb: -47, inRaw: true, inProcessed: true })

/** The slot with a plan applied, as the UI writes it (band<n>.freqHz / gainDb / bwOct, on → 1). */
function applied(slot: ChainSlot, p: NotchPlan): ChainSlot {
  const keys: [string, number][] = [
    [eqKey(p.n, 'freqHz'), p.freqHz],
    [eqKey(p.n, 'gainDb'), p.gainDb],
    [eqKey(p.n, 'bwOct'), p.bwOct],
    ...(p.enable ? ([[eqKey(p.n, 'on'), 1]] as [string, number][]) : []),
  ]
  return keys.reduce<ChainSlot>((s, [key, to]) => withChange([s], { id: key, reason: 'tone', titleMsg: { key: 'x' }, slot: s.index, kind: 'value', key, from: s.values[key] ?? 0, to })[0], slot)
}

describe('eqPointsOf', () => {
  it('reads the bands of a ReaEQ slot in plugin order', () => {
    const points = eqPointsOf(eq())
    expect(points).toHaveLength(5)
    expect(points[0]).toEqual({ n: 1, type: 'Low Shelf', on: true, freqHz: 150, gainDb: 0, bwOct: 2 })
    expect(points.map((p) => p.type)).toEqual(['Low Shelf', 'Band', 'Band', 'Band', 'High Shelf'])
    const off = eqPointsOf(eq([{ type: 'Band', on: false, freqHz: 900, gainDb: -3, bwOct: 0.5 }]))
    expect(off).toEqual([{ n: 1, type: 'Band', on: false, freqHz: 900, gainDb: -3, bwOct: 0.5 }])
  })
})

describe('eqCurveDb', () => {
  it('is flat for flat or disabled bands', () => {
    expect(at(eqPointsOf(eq()), 20, 1000, 20000).every((v) => Math.abs(v) < 1e-9)).toBe(true)
    expect(at([pt(1, { gainDb: -12, on: false })], 1000)[0]).toBeCloseTo(0, 9)
  })

  it('a Band reaches its gain at its frequency, half of it (in dB) at the edges of its width, nothing far away', () => {
    const [centre, edge, far] = at([pt(1, { freqHz: 1000, gainDb: -12, bwOct: 1 })], 1000, 1000 * 2 ** 0.5, 50)
    expect(centre).toBeCloseTo(-12, 1)
    expect(edge).toBeGreaterThan(-7)
    expect(edge).toBeLessThan(-5)
    expect(far).toBeGreaterThan(-0.1)
  })

  it('shelves reach their gain past the corner; bands add up; "Other" types are left out', () => {
    expect(at([pt(1, { type: 'Low Shelf', freqHz: 150, gainDb: 6, bwOct: 2 })], 20)[0]).toBeCloseTo(6, 0)
    expect(at([pt(1, { type: 'High Shelf', freqHz: 8000, gainDb: -4, bwOct: 2 })], 19000)[0]).toBeCloseTo(-4, 0)
    const two = at([pt(1, { freqHz: 1000, gainDb: -6 }), pt(2, { freqHz: 1000, gainDb: -6 })], 1000)[0]
    expect(two).toBeCloseTo(-12, 1)
    expect(at([pt(1, { type: 'Other', gainDb: -12 })], 1000)[0]).toBeCloseTo(0, 9)
  })

  it('a 0.1-octave −24 dB notch is −24 dB on the tone, −12 dB at the edges of its width, under 1 dB half an octave away', () => {
    const [on, edge, off] = at([pt(1, { freqHz: 923, gainDb: -24, bwOct: 0.1 })], 923, 923 * 2 ** 0.05, 923 * 2 ** 0.5)
    expect(on).toBeCloseTo(-24, 1)
    expect(edge).toBeCloseTo(-12, 0)
    expect(off).toBeGreaterThan(-1)
  })
})

describe('notchPlan', () => {
  it('cuts the tone on a free Band: narrow, overDb + 3 deep, on the 0.5 dB grid', () => {
    const p = notchPlan(eqPointsOf(eq()), tone(923.04, 12.3))
    // the guide's 450 Hz band (1.04 oct away) is nearer than its 3500 Hz band (1.92 oct)
    expect(p).toEqual({ n: 3, freqHz: 923, gainDb: -15.5, bwOct: 0.1, enable: false })
  })

  it('prefers the free Band nearest the tone, then the lower band number', () => {
    expect(notchPlan(eqPointsOf(eq()), tone(300))?.n).toBe(2)
    expect(notchPlan(eqPointsOf(eq()), tone(500))?.n).toBe(3)
    const points = [pt(1, { freqHz: 1000 }), pt(2, { freqHz: 16000 })]
    expect(notchPlan(points, tone(4000))?.n).toBe(1)
  })

  it('leaves the guide bands (250, 450, 3500 Hz) to the tone advice when another Band is free', () => {
    const points = [pt(1, { freqHz: 250 }), pt(2, { freqHz: 450 }), pt(3, { freqHz: 6000 })]
    // 450 Hz is nearer to 300 Hz, but the 6 kHz band is nobody's
    expect(notchPlan(points, tone(300))?.n).toBe(3)
    expect(notchPlan(points.slice(0, 2), tone(300))?.n).toBe(1)
  })

  it('takes a disabled Band (and switches it on), and a band within ±0.25 dB of 0', () => {
    const points = [pt(1, { freqHz: 900, gainDb: -3 }), pt(2, { freqHz: 100, gainDb: -8, on: false }), pt(3, { freqHz: 10000, gainDb: 0.25 })]
    expect(notchPlan(points, tone(923))).toMatchObject({ n: 2, enable: true })
    expect(notchPlan(points.slice(0, 1).concat(points.slice(2)), tone(923))).toMatchObject({ n: 3, enable: false })
  })

  it('never takes a used band, a shelf or another type; null when nothing is free', () => {
    const points = [
      pt(1, { type: 'Low Shelf', on: false }),
      pt(2, { type: 'High Shelf', gainDb: 0 }),
      pt(3, { type: 'Other', gainDb: 0 }),
      pt(4, { gainDb: -0.5 }),
      pt(5, { gainDb: 2 }),
    ]
    expect(notchPlan(points, tone(923))).toBeNull()
    expect(notchPlan([], tone(923))).toBeNull()
  })

  it('stays inside the plugin limits and never cuts deeper than −24 dB', () => {
    const deep = notchPlan(eqPointsOf(eq()), tone(923, 40))
    expect(deep?.gainDb).toBe(-24)
    const low = notchPlan(eqPointsOf(eq()), tone(5))
    expect(low?.freqHz).toBe(EQ_LIMITS.freqHz[0])
    expect(low?.bwOct).toBeGreaterThanOrEqual(EQ_LIMITS.bwOct[0])
    expect(notchPlan(eqPointsOf(eq()), tone(923, 0))?.gainDb).toBe(-3)
  })

  it('a placed notch is a notch for the guide and the tuner leaves it alone', () => {
    const slot = eq([...GUIDE_BANDS, { type: 'Band', on: false, freqHz: 1000, gainDb: 0, bwOct: 1 }])
    const p = notchPlan(eqPointsOf(slot), tone(923, 30))
    expect(p).not.toBeNull()
    const plan = p as NotchPlan
    expect(isNotch({ type: 'Band', bw: plan.bwOct })).toBe(true)
    const after = applied(slot, plan)
    const band = eqPointsOf(after).find((b) => b.n === plan.n)
    expect(band).toMatchObject({ on: true, freqHz: plan.freqHz, gainDb: plan.gainDb, bwOct: plan.bwOct })
    const handles = eqHandles([after], 3, () => false)
    expect(handles.some((h) => h.n === plan.n)).toBe(false)
    expect(handles).toHaveLength(eqHandles([slot], 3, () => false).length - (plan.enable ? 0 : 1))
  })
})
