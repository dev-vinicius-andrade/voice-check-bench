import { describe, expect, it } from 'vitest'
import { EQ_LIMITS, SPECTRUM_MAX_HZ, SPECTRUM_MIN_HZ, SPECTRUM_POINTS } from '../../../../desktop/spectrum'
import {
  clampFreq,
  curvePaths,
  dbfsOfY,
  GAIN_RANGE,
  gainOfY,
  hzOfX,
  hzTick,
  nearestIndex,
  plotBox,
  plotFreqs,
  snapGain,
  stepFreq,
  stepWidth,
  xOfHz,
  yOfDbfs,
  yOfGain,
} from './plotScale'

const box = plotBox(800, 260)

describe('plot scale', () => {
  it('maps frequency on a log scale and back', () => {
    expect(xOfHz(box, 20)).toBeCloseTo(box.left, 6)
    expect(xOfHz(box, 20000)).toBeCloseTo(box.left + box.width, 6)
    // 632 Hz is the geometric middle of 20 Hz – 20 kHz
    expect(xOfHz(box, Math.sqrt(20 * 20000))).toBeCloseTo(box.left + box.width / 2, 6)
    for (const hz of [20, 50, 923, 1000, 4567, 20000]) expect(hzOfX(box, xOfHz(box, hz))).toBeCloseTo(hz, 6)
  })

  it('maps the spectrum dBFS (−100 bottom, −20 top) and back, clamped', () => {
    expect(yOfDbfs(box, -20)).toBeCloseTo(box.top, 6)
    expect(yOfDbfs(box, -100)).toBeCloseTo(box.top + box.height, 6)
    expect(yOfDbfs(box, -200)).toBeCloseTo(box.top + box.height, 6)
    expect(yOfDbfs(box, 0)).toBeCloseTo(box.top, 6)
    for (const db of [-100, -73.5, -20]) expect(dbfsOfY(box, yOfDbfs(box, db))).toBeCloseTo(db, 6)
  })

  it('maps the EQ gain around the centre line (± the gain range) and back', () => {
    const [lo, hi] = [-GAIN_RANGE, GAIN_RANGE]
    expect(yOfGain(box, 0)).toBeCloseTo(box.top + box.height / 2, 6)
    expect(yOfGain(box, hi)).toBeCloseTo(box.top, 6)
    expect(yOfGain(box, lo)).toBeCloseTo(box.top + box.height, 6)
    for (const db of [lo, -12.5, 0, 3, hi]) expect(gainOfY(box, yOfGain(box, db))).toBeCloseTo(db, 6)
  })

  it('snaps the gain to 0.5 dB and clamps frequency, gain and width to the plugin ranges', () => {
    expect(snapGain(-12.3)).toBe(-12.5)
    expect(snapGain(0.2)).toBe(0)
    expect(Object.is(snapGain(-0.2), -0)).toBe(false)
    expect(snapGain(40)).toBe(EQ_LIMITS.gainDb[1])
    expect(snapGain(-40)).toBe(EQ_LIMITS.gainDb[0])
    expect(clampFreq(5)).toBe(EQ_LIMITS.freqHz[0])
    expect(clampFreq(30000)).toBe(EQ_LIMITS.freqHz[1])
    expect(stepFreq(1000, 1)).toBeCloseTo(1000 * 2 ** (1 / 24), 9)
    expect(stepFreq(1000, -24)).toBeCloseTo(500, 9)
    expect(stepFreq(20000, 1)).toBe(20000)
    expect(stepWidth(1, 1)).toBeGreaterThan(1)
    expect(stepWidth(1, -1)).toBeLessThan(1)
    expect(stepWidth(EQ_LIMITS.bwOct[0], -1)).toBe(EQ_LIMITS.bwOct[0])
    expect(stepWidth(EQ_LIMITS.bwOct[1], 1)).toBe(EQ_LIMITS.bwOct[1])
  })

  it('has the analyzer\'s log-spaced points and finds the nearest one', () => {
    const f = plotFreqs()
    expect(f).toHaveLength(SPECTRUM_POINTS)
    expect(f[0]).toBeCloseTo(SPECTRUM_MIN_HZ, 3)
    expect(f[SPECTRUM_POINTS - 1]).toBeCloseTo(SPECTRUM_MAX_HZ, 0)
    expect(nearestIndex(f, 20)).toBe(0)
    expect(nearestIndex(f, 25000)).toBe(SPECTRUM_POINTS - 1)
    const k = nearestIndex(f, 923)
    expect(Math.abs(Math.log(f[k] / 923))).toBeLessThan(Math.log(f[1] / f[0]))
  })

  it('draws the EQ curve and its area down to the 0 dB line', () => {
    const { line, area } = curvePaths(box, new Float32Array([20, 20000]), new Float32Array([0, -EQ_LIMITS.gainDb[1]]))
    expect(line).toBe(`M${box.left.toFixed(1)},${yOfGain(box, 0).toFixed(1)}L${(box.left + box.width).toFixed(1)},${(box.top + box.height).toFixed(1)}`)
    expect(area.startsWith(`M${box.left.toFixed(1)},${yOfGain(box, 0).toFixed(1)}L`)).toBe(true)
    expect(area.endsWith('Z')).toBe(true)
    expect(curvePaths(box, new Float32Array(0), new Float32Array(0)).line).toBe('')
  })

  it('labels the grid frequencies', () => {
    const num = (v: number) => String(v)
    expect(hzTick(50, num)).toBe('50')
    expect(hzTick(1000, num)).toBe('1k')
    expect(hzTick(10000, num)).toBe('10k')
  })
})
