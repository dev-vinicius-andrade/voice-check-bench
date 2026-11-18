import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import i18n from '../../i18n'
import en from '../../i18n/locales/en/desktop.json'
import { desktopBridge } from '../../desktop/bridge'
import type { EngineInfo } from '../../desktop/types'
import { hashToRoute, hashToScreen, screenToHash } from '../../hooks/useHashRoute'
import { defaultUiPrefs, loadUiPrefs } from '../../storage/prefs'
import { theme } from '../../theme'
import { DesktopScreen } from './DesktopScreen'

const tauriWindow = window as unknown as Record<string, unknown>
const INFO: EngineInfo = { appVersion: '0.1.0', rustVersion: 'rustc 1.99.1', os: 'windows', arch: 'x86_64' }

beforeAll(() => i18n.changeLanguage('en'))
afterEach(() => {
  cleanup()
  delete tauriWindow.__TAURI_INTERNALS__
  localStorage.clear()
})

describe('desktop route', () => {
  it('is home on the web and desktop inside the app', () => {
    expect(hashToRoute('#/desktop')).toBe('home')
    tauriWindow.__TAURI_INTERNALS__ = {}
    expect(hashToRoute('#/desktop')).toBe('desktop')
  })

  it('#/desktop/live is the live tuning screen, inside the app only', () => {
    expect(hashToRoute('#/desktop/live')).toBe('home')
    expect(screenToHash('desktopLive')).toBe('#/desktop/live')
    tauriWindow.__TAURI_INTERNALS__ = {}
    expect(hashToRoute('#/desktop/live')).toBe('desktopLive')
    expect(hashToRoute('#/desktop/live/')).toBe('desktopLive')
    expect(hashToScreen('#/desktop/live', { screen: 'desktop', step: 0, hasSessionTakes: false })).toEqual({ screen: 'desktopLive' })
    expect(hashToScreen('#/desktop', { screen: 'desktopLive', step: 0, hasSessionTakes: false })).toEqual({ screen: 'desktop' })
  })

  it('the app opens on the desktop screen; the web never restores it', () => {
    localStorage.setItem('vcb-ui', JSON.stringify({ screen: 'desktop' }))
    expect(loadUiPrefs().screen).toBe('home')
    localStorage.setItem('vcb-ui', JSON.stringify({ screen: 'desktopLive' }))
    expect(loadUiPrefs().screen).toBe('home')
    localStorage.setItem('vcb-ui', JSON.stringify({ screen: 'live' }))
    expect(loadUiPrefs().screen).toBe('live')
    tauriWindow.__TAURI_INTERNALS__ = {}
    expect(loadUiPrefs().screen).toBe('desktop')
    expect(defaultUiPrefs().screen).toBe('desktop')
  })
})

describe('DesktopScreen', () => {
  const view = (load: () => Promise<EngineInfo>, page?: 'autotune' | 'live') =>
    render(
      <ThemeProvider theme={theme}>
        <DesktopScreen page={page} bridge={{ ...desktopBridge, engineInfo: load, audioDevices: () => new Promise(() => undefined) }} />
      </ThemeProvider>,
    )

  it('opens on Tune from a recording, with the two desktop screens in its nav', () => {
    view(() => Promise.resolve(INFO))
    const U = en.desktop.autotune.ui
    expect(screen.getByRole('heading', { name: U.title })).toBeTruthy()
    expect(screen.getByRole('heading', { name: U.record.title })).toBeTruthy()
    const nav = screen.getByRole('tablist', { name: U.nav.label })
    expect(within(nav).getByRole('tab', { name: U.nav.record }).getAttribute('aria-selected')).toBe('true')
    expect(within(nav).getByRole('tab', { name: U.nav.live }).getAttribute('href')).toBe('#/desktop/live')
  })

  it('the live page shows the live tuning screen with the engine info in a footer line', async () => {
    view(() => Promise.resolve(INFO), 'live')
    expect(screen.getByRole('heading', { name: en.desktop.title })).toBeTruthy()
    expect(screen.getByRole('tab', { name: en.desktop.autotune.ui.nav.live }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText(en.desktop.tune.idle)).toBeTruthy()
    expect(screen.getByRole('button', { name: en.desktop.tune.save })).toHaveProperty('disabled', true)
    const footer = await screen.findByTestId('engine-footer')
    await waitFor(() => expect(footer.textContent).toContain('rustc 1.99.1'))
    for (const v of ['0.1.0', 'windows', 'x86_64']) expect(footer.textContent).toContain(v)
  })

  it('shows an error when the engine does not answer', async () => {
    view(() => Promise.reject(new Error('boom')))
    expect(await screen.findByText(/boom/)).toBeTruthy()
  })
})
