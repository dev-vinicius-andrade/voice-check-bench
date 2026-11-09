import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import i18n from '../../i18n'
import { theme } from '../../theme'
import { HostPicker } from './HostPicker'
import { HOST_KEY, loadHost, saveHost, useHost } from './hostPref'

function Harness() {
  const [host, setHost] = useHost()
  return <HostPicker host={host} onPick={setHost} />
}
const renderPicker = () => render(<ThemeProvider theme={theme}><Harness /></ThemeProvider>)

beforeAll(async () => {
  await i18n.changeLanguage('en')
})
beforeEach(() => localStorage.clear())
afterEach(cleanup)

describe('host preference', () => {
  it('saves, loads and clears the host; ignores unknown values', () => {
    expect(loadHost()).toBeNull()
    saveHost('obs')
    expect(localStorage.getItem(HOST_KEY)).toBe('"obs"')
    expect(loadHost()).toBe('obs')
    localStorage.setItem(HOST_KEY, '"winamp"')
    expect(loadHost()).toBeNull()
    saveHost(null)
    expect(localStorage.getItem(HOST_KEY)).toBeNull()
  })
})

describe('HostPicker', () => {
  it('persists the picked host and restores it on the next mount', () => {
    renderPicker()
    fireEvent.click(screen.getByRole('radio', { name: /Elgato Wave Link/ }))
    expect(loadHost()).toBe('wavelink')
    expect(screen.getByText('You picked: Elgato Wave Link')).toBeTruthy()
    cleanup()
    renderPicker()
    expect(screen.getByText('You picked: Elgato Wave Link')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    expect(loadHost()).toBeNull()
    expect(screen.getAllByRole('radio')).toHaveLength(5)
  })

  it('"Not sure" shows the chooser and its buttons pick a host', () => {
    renderPicker()
    fireEvent.click(screen.getByRole('radio', { name: /Not sure/ }))
    expect(screen.getByTestId('host-unsure')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Use OBS Studio' }))
    expect(loadHost()).toBe('obs')
  })
})
