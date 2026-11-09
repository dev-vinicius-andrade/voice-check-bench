import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  loadDeviceChoice,
  loadMicProfile,
  loadUiPrefs,
  readPref,
  saveDeviceChoice,
  saveMicProfile,
  saveUiPrefs,
  writePref,
  type UiPrefs,
} from './prefs'
import { DEFAULT_MIC } from '../mics/catalog'

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

  it('returns defaults for corrupt JSON or bad shapes', () => {
    localStorage.setItem('vcb-ui', '{not json')
    localStorage.setItem('vcb-devs', '[1,2]')
    const ui = loadUiPrefs()
    expect(ui).toMatchObject({ screen: 'setup', step: 0, A: null, B: null, view: 'a', fxDist: null })
    expect(ui.session).toMatch(/^s\d+$/)
    expect(loadDeviceChoice()).toEqual({ raw: null, fx: null })

    localStorage.setItem('vcb-ui', JSON.stringify({ screen: 'nope', step: -1, view: 'x', A: 'a', session: 7 }))
    expect(loadUiPrefs()).toMatchObject({ screen: 'setup', step: 0, view: 'a', A: null })
  })

  it('returns defaults when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => saveUiPrefs(loadUiPrefs())).not.toThrow()
    expect(loadUiPrefs().screen).toBe('setup')
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
})
