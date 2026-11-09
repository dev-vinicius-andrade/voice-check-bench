import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadDeviceChoice, loadUiPrefs, readPref, saveDeviceChoice, saveUiPrefs, writePref, type UiPrefs } from './prefs'

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
  })
})
