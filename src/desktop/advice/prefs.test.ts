import { afterEach, describe, expect, it, vi } from 'vitest'
import { TONE_MAX_DB } from '../../live/hints'
import { AMOUNT_STEP_DB, DEFAULT_TUNING_PREFS, loadTuningPrefs, parseTuningPrefs, saveTuningPrefs, TUNING_PREFS_KEY } from './prefs'

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('tuning prefs', () => {
  it('defaults: medium processing, natural noise; steps 2 / 4 / TONE_MAX_DB', () => {
    expect(DEFAULT_TUNING_PREFS).toEqual({ amount: 'medium', noise: 'natural' })
    expect(AMOUNT_STEP_DB).toEqual({ light: 2, medium: 4, strong: TONE_MAX_DB })
    expect(TONE_MAX_DB).toBe(6)
  })

  it('round-trips through localStorage', () => {
    saveTuningPrefs({ amount: 'strong', noise: 'max' })
    expect(JSON.parse(localStorage.getItem(TUNING_PREFS_KEY) ?? 'null')).toEqual({ amount: 'strong', noise: 'max' })
    expect(loadTuningPrefs()).toEqual({ amount: 'strong', noise: 'max' })
  })

  it('bad or missing values fall back per field', () => {
    expect(loadTuningPrefs()).toEqual(DEFAULT_TUNING_PREFS)
    expect(parseTuningPrefs({ amount: 'huge', noise: 'max' })).toEqual({ amount: 'medium', noise: 'max' })
    expect(parseTuningPrefs({ amount: 'light', noise: 3 })).toEqual({ amount: 'light', noise: 'natural' })
    expect(parseTuningPrefs(['light'])).toEqual(DEFAULT_TUNING_PREFS)
    expect(parseTuningPrefs('max')).toEqual(DEFAULT_TUNING_PREFS)
    localStorage.setItem(TUNING_PREFS_KEY, '{not json')
    expect(loadTuningPrefs()).toEqual(DEFAULT_TUNING_PREFS)
  })

  it('blocked storage: defaults, and saving does not throw', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(loadTuningPrefs()).toEqual(DEFAULT_TUNING_PREFS)
    expect(() => saveTuningPrefs({ amount: 'light', noise: 'max' })).not.toThrow()
  })
})
