import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  loadApplied,
  loadDeviceChoice,
  loadGoal,
  loadMains,
  loadMicProfile,
  loadUiPrefs,
  readPref,
  saveApplied,
  saveDeviceChoice,
  saveGoal,
  saveMains,
  saveMicProfile,
  saveUiPrefs,
  writePref,
  type UiPrefs,
} from './prefs'
import { DEFAULT_MIC } from '../mics/catalog'
import { realSession } from '../plain/testFixtures'

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('prefs', () => {
  it('round-trips UI prefs and device choice', () => {
    const ui: UiPrefs = { screen: 'results', step: 'free', session: 's123', A: 5, B: null, view: 'diff', fxDist: '8 cm' }
    saveUiPrefs(ui)
    expect(loadUiPrefs()).toEqual(ui)
    saveDeviceChoice({ raw: 'mic-1', fx: null })
    expect(loadDeviceChoice()).toEqual({ raw: 'mic-1', fx: null })
    writePref('k', { a: 1 })
    expect(readPref('k', null)).toEqual({ a: 1 })
  })

  it('accepts every screen, site pages included; a new visitor starts on home', () => {
    expect(loadUiPrefs().screen).toBe('home')
    for (const screen of ['home', 'how', 'community', 'privacy', 'setup', 'step', 'results'] as const) {
      saveUiPrefs({ screen, step: 1, session: 's1', A: null, B: null, view: 'a', fxDist: null })
      expect(loadUiPrefs().screen).toBe(screen)
    }
  })

  it('returns defaults for corrupt JSON or bad shapes', () => {
    localStorage.setItem('vcb-ui', '{not json')
    localStorage.setItem('vcb-devs', '[1,2]')
    const ui = loadUiPrefs()
    expect(ui).toMatchObject({ screen: 'home', step: 0, A: null, B: null, view: 'a', fxDist: null })
    expect(ui.session).toMatch(/^s\d+$/)
    expect(loadDeviceChoice()).toEqual({ raw: null, fx: null })

    localStorage.setItem('vcb-ui', JSON.stringify({ screen: 'nope', step: -1, view: 'x', A: 'a', session: 7 }))
    expect(loadUiPrefs()).toMatchObject({ screen: 'home', step: 0, view: 'a', A: null })
  })

  it('returns defaults when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => saveUiPrefs(loadUiPrefs())).not.toThrow()
    expect(loadUiPrefs().screen).toBe('home')
    expect(loadDeviceChoice()).toEqual({ raw: null, fx: null })
    expect(readPref('x', 42)).toBe(42)
    expect(loadMicProfile()).toEqual(DEFAULT_MIC)
    expect(() => saveMicProfile(DEFAULT_MIC)).not.toThrow()
  })

  it('round-trips the mic profile and validates its shape', () => {
    expect(loadMicProfile()).toEqual(DEFAULT_MIC)
    const mic = { model: 'Shure SM7B', kind: 'dynamic', pattern: 'cardioid', address: 'end' } as const
    saveMicProfile(mic)
    expect(loadMicProfile()).toEqual(mic)
    localStorage.setItem('vcb-mic', JSON.stringify({ model: 3, kind: 'ribbon', pattern: 'omni', address: 'top' }))
    expect(loadMicProfile()).toEqual({ model: '', kind: 'unknown', pattern: 'omni', address: 'unknown' })
    localStorage.setItem('vcb-mic', '[1]')
    expect(loadMicProfile()).toEqual(DEFAULT_MIC)
    localStorage.setItem('vcb-mic', '{bad')
    expect(loadMicProfile()).toEqual(DEFAULT_MIC)
  })

  it('reads the legacy "Other" model as not listed', () => {
    localStorage.setItem('vcb-mic', JSON.stringify({ model: 'Other', kind: 'dynamic', pattern: 'cardioid', address: 'end' }))
    expect(loadMicProfile().model).toBe('')
  })

  it('round-trips the mains setting, auto by default and for bad data', () => {
    expect(loadMains()).toBe('auto')
    saveMains(60)
    expect(loadMains()).toBe(60)
    saveMains('auto')
    expect(loadMains()).toBe('auto')
    localStorage.setItem('vcb-mains', '"55"')
    expect(loadMains()).toBe('auto')
  })
})

describe('voice goal pref', () => {
  it('round-trips, defaults to natural and validates its shape', () => {
    expect(loadGoal()).toEqual({ style: 'natural', perceived: [] })
    saveGoal({ style: 'warm', perceived: ['nasal', 'sharpS'] })
    expect(loadGoal()).toEqual({ style: 'warm', perceived: ['nasal', 'sharpS'] })
    localStorage.setItem('vcb-goal', JSON.stringify({ style: 'loud', perceived: ['dull', 'dull', 3, 'nope'] }))
    expect(loadGoal()).toEqual({ style: 'natural', perceived: ['dull'] })
    localStorage.setItem('vcb-goal', JSON.stringify({ style: 'clear', perceived: 'nasal' }))
    expect(loadGoal()).toEqual({ style: 'clear', perceived: [] })
    for (const bad of ['{bad', '[]', '"warm"', 'null']) {
      localStorage.setItem('vcb-goal', bad)
      expect(loadGoal()).toEqual({ style: 'natural', perceived: [] })
    }
  })

  it('falls back to the default when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => saveGoal({ style: 'warm', perceived: [] })).not.toThrow()
    expect(loadGoal()).toEqual({ style: 'natural', perceived: [] })
  })
})

describe('applied settings pref', () => {
  it('round-trips, removes on null and validates its shape', () => {
    const { applied } = realSession()
    expect(loadApplied()).toBeNull()
    saveApplied(applied)
    expect(JSON.parse(localStorage.getItem('vcb-applied') ?? 'null')).toEqual(applied)
    expect(loadApplied()).toEqual(applied)
    saveApplied(null)
    expect(localStorage.getItem('vcb-applied')).toBeNull()
    const bad = [
      { ...applied, attempt: 0 },
      { ...applied, attempt: 1.5 },
      { ...applied, noiseRemoval: 'magic' },
      { ...applied, dist: '' },
      { ...applied, date: 'yesterday' },
      { ...applied, id: 7 },
      { ...applied, settings: { ...applied.settings, gate: { ...applied.settings.gate, threshold: 20 } } },
      { ...applied, settings: { ...applied.settings, eq: 'none' } },
      { ...applied, settings: undefined },
    ]
    for (const v of bad) {
      localStorage.setItem('vcb-applied', JSON.stringify(v))
      expect(loadApplied(), JSON.stringify(v).slice(0, 60)).toBeNull()
    }
    for (const v of ['{bad', '[]', '"x"', 'null']) {
      localStorage.setItem('vcb-applied', v)
      expect(loadApplied()).toBeNull()
    }
    // unknown keys are dropped
    localStorage.setItem('vcb-applied', JSON.stringify({ ...applied, extra: 1 }))
    expect(loadApplied()).toEqual(applied)
  })

  it('reads nothing applied when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => saveApplied(realSession().applied)).not.toThrow()
    expect(() => saveApplied(null)).not.toThrow()
    expect(loadApplied()).toBeNull()
  })
})
