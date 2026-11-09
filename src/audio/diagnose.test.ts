// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { Analysis, CheckId } from '../types'
import { analyze } from './analyze'
import { countByStatus, diagnose, f1, topIssues } from './diagnose'
import { fakeAnalysis, syntheticTake } from './testSignals'

const ALL_IDS: CheckId[] = [
  'level', 'peaks', 'noise', 'silence', 'hum',
  'rumble', 'boom', 'warmth', 'mud', 'body', 'definition', 'presence', 'sibilance', 'air',
  'harsh', 'consistency',
]

describe('diagnose', () => {
  it('gives unique ids and valid statuses on a synthetic take, in the prototype order', () => {
    const checks = diagnose(analyze(syntheticTake(), 48000) as Analysis)
    const ids = checks.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(ALL_IDS.filter((id) => ids.includes(id)))
    for (const c of checks) {
      expect(['good', 'warn', 'bad']).toContain(c.status)
      expect(c.title).not.toBe('')
      expect(c.value).not.toBe('')
      expect(c.detail).not.toBe('')
      expect(c.fix === '').toBe(c.status === 'good')
    }
  })

  it('emits all 16 checks in order when every optional check applies', () => {
    const a = fakeAnalysis({ quietBroken: true, hum: [{ hz: 50, db: 3 }, { hz: 60, db: 8 }], sibP95: -4 })
    const checks = diagnose(a)
    expect(checks.map((c) => c.id)).toEqual(ALL_IDS)
  })

  it('a reference-shaped take passes the tone checks', () => {
    const checks = diagnose(fakeAnalysis())
    expect(checks.map((c) => c.id)).not.toContain('silence')
    expect(checks.map((c) => c.id)).not.toContain('hum')
    expect(checks.map((c) => c.id)).not.toContain('harsh')
    expect(checks.every((c) => c.status === 'good')).toBe(true)
    expect(checks.find((c) => c.id === 'boom')).toEqual({
      id: 'boom', status: 'good', title: 'Boom (80–160 Hz)', value: '0.0 dB vs reference', detail: 'Bass is in a healthy range.', fix: '',
    })
  })

  it('ports thresholds and texts from the prototype', () => {
    const a = fakeAnalysis({ speechMed: -30, clip: 3, peak: 0, noise: -60, snr: 30, noiseFromQuiet: false, hum: [{ hz: 60, db: 14 }], spread: 13 })
    const by = Object.fromEntries(diagnose(a).map((c) => [c.id, c]))
    expect(by.level).toMatchObject({ status: 'warn', value: '-30.0 dBFS median', detail: 'Voice is quiet; listeners will turn you up, raising noise too.' })
    expect(by.peaks).toMatchObject({ status: 'bad', value: 'peak 0.0 dBFS · 3 clipped samples' })
    expect(by.noise).toMatchObject({ status: 'warn', value: '-60.0 dBFS in silence · SNR 30 dB', detail: 'No clean 3 s silence found; estimate is rough. Hiss, fans or room noise are audible in pauses.' })
    expect(by.hum).toMatchObject({ status: 'bad', value: 'strongest 60 Hz, +14.0 dB over neighbours', detail: 'A steady buzz sits under your voice.' })
    expect(by.consistency).toMatchObject({ status: 'bad', value: '13.0 dB spread between seconds' })
    // gated noise floor downgrades bad hum to warn
    const gated = diagnose(fakeAnalysis({ noise: -80, hum: [{ hz: 50, db: 20 }] })).find((c) => c.id === 'hum')
    expect(gated?.status).toBe('warn')
  })

  it('grades band deviations: |v| <= 3 good, <= 6 warn, else bad; rumble one-sided', () => {
    // level-matching offset is the mean over bands 1..7, so shift only band 8 (air) and band 0 (rumble)
    const rel = [-18 + 9, -4, -1, 2, 0, -6, -7, -11, -17 - 5]
    const by = Object.fromEntries(diagnose(fakeAnalysis({ rel })).map((c) => [c.id, c]))
    expect(by.air).toMatchObject({ status: 'warn', value: '-5.0 dB vs reference', detail: 'Very little top end. Common for budget dynamics like the K688.' })
    expect(by.rumble).toMatchObject({ status: 'bad', value: '+9.0 dB vs reference' })
    const low = Object.fromEntries(diagnose(fakeAnalysis({ rel: [-40, -4, -1, 2, 0, -6, -7, -11, -17] })).map((c) => [c.id, c]))
    expect(low.rumble.status).toBe('good')
  })
})

describe('verdict helpers', () => {
  const a = fakeAnalysis({ quietBroken: true, clip: 2, speechMed: -30, spread: 10, sibP95: -3 })
  const checks = diagnose(a)

  it('countByStatus', () => {
    expect(countByStatus(checks)).toEqual({
      bad: checks.filter((c) => c.status === 'bad').length,
      warn: checks.filter((c) => c.status === 'warn').length,
    })
    expect(countByStatus(checks).bad).toBe(1)
  })

  it('topIssues lists bad first, then warn, without the silence window', () => {
    expect(topIssues(checks).map((c) => c.id)).toEqual(['peaks', 'level', 'harsh'])
    expect(topIssues(checks, 10).map((c) => c.id)).toEqual(['peaks', 'level', 'harsh', 'consistency'])
    expect(topIssues(diagnose(fakeAnalysis()))).toEqual([])
  })

  it('f1 formats signed one-decimal numbers', () => {
    expect(f1(1.25)).toBe('+1.3')
    expect(f1(-2)).toBe('-2.0')
    expect(f1(0)).toBe('0.0')
  })
})
