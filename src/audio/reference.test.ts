import { describe, expect, it } from 'vitest'
import { relWithDev, voiceAnalysis } from '../plain/testFixtures'
import { DEFAULT_GOAL, type VoiceStyle } from '../types'
import { diagnose } from './diagnose'
import { BANDS, STYLE_OFFSETS, deviations, targetDeviations } from './reference'
import { fakeAnalysis } from './testSignals'

describe('STYLE_OFFSETS', () => {
  it('has one offset per band for every style, natural all zero, values from the SPEC', () => {
    expect(Object.keys(STYLE_OFFSETS).sort()).toEqual(['bright', 'clear', 'natural', 'warm'])
    for (const style of Object.keys(STYLE_OFFSETS) as VoiceStyle[]) {
      expect(STYLE_OFFSETS[style]).toHaveLength(BANDS.length)
      expect(STYLE_OFFSETS[style][0]).toBe(0)
    }
    expect(STYLE_OFFSETS.natural).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(STYLE_OFFSETS.warm).toEqual([0, 3, 2, 0, 1, 0, -1, -1, -1])
    expect(STYLE_OFFSETS.clear).toEqual([0, -1, -1, -1, 0, 2, 3, 1, 1])
    expect(STYLE_OFFSETS.bright).toEqual([0, 0, -1, 0, 0, 0, 1, 2, 3])
  })
})

describe('targetDeviations', () => {
  it('is deviations() for the natural goal and by default', () => {
    for (const rel of [relWithDev(1, 5), relWithDev(6, -7), [-18, 8, -1, 2, 0, -6, -7, -11, -17], [NaN, 1, 2, 3, 4, 5, 6, 7, 8]]) {
      expect(targetDeviations(rel)).toEqual(deviations(rel))
      expect(targetDeviations(rel, DEFAULT_GOAL)).toEqual(deviations(rel))
    }
  })

  it('subtracts the style offset per band', () => {
    const rel = relWithDev(1, 5)
    const d = deviations(rel)
    const warm = targetDeviations(rel, { style: 'warm', perceived: [] })
    warm.forEach((v, i) => expect(v).toBeCloseTo(d[i] - STYLE_OFFSETS.warm[i], 10))
    // clear: the presence target is 3 dB higher, so the same voice reads 3 dB lower there
    expect(targetDeviations(BANDS.map((b) => b.ref), { style: 'clear', perceived: [] })[6]).toBeCloseTo(-3, 10)
  })
})

describe('diagnose with a goal', () => {
  it('natural goal = no goal', () => {
    for (const a of [fakeAnalysis(), voiceAnalysis(1, 5), voiceAnalysis(6, -8)]) expect(diagnose(a, DEFAULT_GOAL)).toEqual(diagnose(a))
  })

  it('judges band checks against the target with the same wording', () => {
    const boomy = voiceAnalysis(1, 5)
    const natural = diagnose(boomy).find((c) => c.id === 'boom')
    const warm = diagnose(boomy, { style: 'warm', perceived: [] }).find((c) => c.id === 'boom')
    expect(natural?.status).toBe('warn')
    expect(warm?.status).toBe('good')
    expect(warm?.valueMsg?.key).toBe(natural?.valueMsg?.key)
    expect(warm?.valueMsg?.params?.dev).toBeCloseTo(2, 10)
  })
})
