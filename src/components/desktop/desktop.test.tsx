import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import i18n from '../../i18n'
import en from '../../i18n/locales/en/desktop.json'
import type { EngineInfo } from '../../desktop/types'
import { hashToRoute } from '../../hooks/useHashRoute'
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

  it('the app opens on the desktop screen; the web never restores it', () => {
    localStorage.setItem('vcb-ui', JSON.stringify({ screen: 'desktop' }))
    expect(loadUiPrefs().screen).toBe('home')
    localStorage.setItem('vcb-ui', JSON.stringify({ screen: 'live' }))
    expect(loadUiPrefs().screen).toBe('live')
    tauriWindow.__TAURI_INTERNALS__ = {}
    expect(loadUiPrefs().screen).toBe('desktop')
    expect(defaultUiPrefs().screen).toBe('desktop')
  })
})

describe('DesktopScreen', () => {
  const view = (load: () => Promise<EngineInfo>) =>
    render(
      <ThemeProvider theme={theme}>
        <DesktopScreen load={load} />
      </ThemeProvider>,
    )

  it('shows the engine info', async () => {
    view(() => Promise.resolve(INFO))
    expect(screen.getByRole('heading', { name: en.desktop.title })).toBeTruthy()
    expect(screen.getByText(en.desktop.coming)).toBeTruthy()
    expect(await screen.findByText('rustc 1.99.1')).toBeTruthy()
    for (const v of ['0.1.0', 'windows', 'x86_64']) expect(screen.getByText(v)).toBeTruthy()
  })

  it('shows an error when the engine does not answer', async () => {
    view(() => Promise.reject(new Error('boom')))
    expect(await screen.findByText(/boom/)).toBeTruthy()
  })
})
