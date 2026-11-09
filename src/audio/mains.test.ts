// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { Analysis } from '../types'
import { analyze } from './analyze'
import { diagnose } from './diagnose'
import { humFrequencies, isMainsSetting, mainsForLocale, regionOf, resolveMains } from './mains'
import { fakeAnalysis, syntheticTake } from './testSignals'

describe('mains region', () => {
  it('reads the region subtag', () => {
    expect(regionOf('pt-BR')).toBe('BR')
    expect(regionOf('en_us')).toBe('US')
    expect(regionOf('zh-Hant-TW')).toBe('TW')
    expect(regionOf('es-419')).toBe('419')
    expect(regionOf('de')).toBeNull()
  })

  it('maps 60 Hz regions to 60 and everything else to 50', () => {
    for (const tag of ['en-US', 'en-CA', 'fr-CA', 'es-MX', 'pt-BR', 'es-CO', 'es-VE', 'fil-PH', 'zh-TW', 'ko-KR', 'ar-SA', 'ja-JP']) {
      expect(mainsForLocale([tag]), tag).toBe(60)
    }
    for (const tag of ['en-GB', 'pt-PT', 'de-DE', 'fr-FR', 'es-AR', 'en-AU', 'en-IN', 'es-419']) {
      expect(mainsForLocale([tag]), tag).toBe(50)
    }
  })

  it('uses the first tag that names a region, 50 when none does', () => {
    expect(mainsForLocale(['en', 'pt-BR'])).toBe(60)
    expect(mainsForLocale(['de-DE', 'en-US'])).toBe(50)
    expect(mainsForLocale(['pt'])).toBe(50)
    expect(mainsForLocale([])).toBe(50)
  })

  it('resolves auto from the given tags, a fixed choice as is', () => {
    expect(resolveMains('auto', ['pt-BR'])).toBe(60)
    expect(resolveMains('auto', ['it-IT'])).toBe(50)
    expect(resolveMains(50, ['pt-BR'])).toBe(50)
    expect(resolveMains(60, ['it-IT'])).toBe(60)
  })

  it('validates stored settings', () => {
    expect([50, 60, 'auto'].every(isMainsSetting)).toBe(true)
    expect([55, '60', null, 'on'].some(isMainsSetting)).toBe(false)
  })
})

describe('hum family preference', () => {
  it('lists the local family first, the prototype order when unknown', () => {
    expect(humFrequencies(50)).toEqual([50, 100, 150, 60, 120, 180])
    expect(humFrequencies(60)).toEqual([60, 120, 180, 50, 100, 150])
    expect(humFrequencies()).toEqual([50, 60, 100, 120, 150, 180])
  })

  it('analyze measures both families, local family first', () => {
    const x = syntheticTake({ noiseDb: -60, speechDb: -25, tones: [{ hz: 120, db: -45 }] })
    const a60 = analyze(x, 48000, { mains: 60 }) as Analysis
    const a50 = analyze(x, 48000, { mains: 50 }) as Analysis
    const plain = analyze(x, 48000) as Analysis
    expect(a60.hum.map((h) => h.hz)).toEqual([60, 120, 180, 50, 100, 150])
    expect(a50.hum.map((h) => h.hz)).toEqual([50, 100, 150, 60, 120, 180])
    expect(plain.hum.map((h) => h.hz)).toEqual([50, 60, 100, 120, 150, 180])
    // same peaks, only the order changes
    const byHz = (a: Analysis) => Object.fromEntries(a.hum.map((h) => [h.hz, h.db]))
    expect(byHz(a60)).toEqual(byHz(plain))
    // the 120 Hz hum is reported even where the grid runs at 50 Hz, because it is the strongest
    const hum = (a: Analysis) => diagnose(a).find((c) => c.id === 'hum')
    expect(hum(a50)?.valueMsg?.params?.hz).toBe(120)
    expect(hum(a60)?.valueMsg?.params?.hz).toBe(120)
    expect(hum(a60)?.detailMsg.params?.hz).toBe(120)
  })

  it('on a tie the local family wins; a stronger peak of the other family still wins', () => {
    const peaks = (mains: 50 | 60, db: Record<number, number>) => humFrequencies(mains).map((hz) => ({ hz, db: db[hz] ?? 2 }))
    const reported = (mains: 50 | 60, db: Record<number, number>) =>
      diagnose(fakeAnalysis({ hum: peaks(mains, db) })).find((c) => c.id === 'hum')?.valueMsg?.params?.hz
    // spectral leakage makes the 50 and 60 Hz bins read alike: the local grid decides
    expect(reported(60, { 50: 14, 60: 14 })).toBe(60)
    expect(reported(50, { 50: 14, 60: 14 })).toBe(50)
    // a clearly stronger peak from the other family is still reported
    expect(reported(60, { 50: 18, 60: 12 })).toBe(50)
    expect(reported(50, { 100: 9, 120: 16 })).toBe(120)
  })
})
