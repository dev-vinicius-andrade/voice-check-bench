import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import i18n from '../../i18n'
import { suggest } from '../../settings/suggest'
import { SHEET_FIXTURES } from '../../settings/sheetFixtures'
import { theme } from '../../theme'
import type { Suggestion } from '../../types'
import { ObsGuide } from './ObsGuide'
import { WaveLinkGuide } from './WaveLinkGuide'
import { NR_CHOICE_KEY } from './nrChoice'
import { waveLinkSteps } from './waveLinkSteps'

const fixture = (name: string): Suggestion => {
  const [take, dist] = SHEET_FIXTURES[name]
  return suggest(take, dist)!
}
const wrap = (node: React.ReactNode) => render(<ThemeProvider theme={theme}>{node}</ThemeProvider>)

beforeAll(async () => {
  await i18n.changeLanguage('en')
})
afterEach(cleanup)
beforeEach(() => localStorage.removeItem(NR_CHOICE_KEY))

describe('guide paths', () => {
  it('Wave Link: one checklist entry per step; "Done, next" advances', () => {
    const s = fixture('noisyCondenserSide')
    wrap(<WaveLinkGuide s={s} />)
    expect(screen.getByTestId('guide-progress').textContent).toBe(`Step 1 of ${waveLinkSteps(s).length}`)
    expect(screen.getByText('ReaFIR: let it learn your room')).toBeTruthy()
    expect(screen.getByText(`ReaEQ: band ${s.eq.length} of ${s.eq.length}`)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Done, next' }))
    expect(screen.getByTestId('guide-progress').textContent).toBe(`Step 2 of ${waveLinkSteps(s).length}`)
    expect(screen.getByText(/Apply automatically instead/)).toBeTruthy()
  })

  it('Wave Link quiet room: no ReaFIR steps', () => {
    wrap(<WaveLinkGuide s={fixture('quietEq')} />)
    expect(screen.queryByText(/ReaFIR/)).toBeNull()
  })

  it('Wave Link, voice close to the room: AI noise removal first; picking Elgato skips ReaFIR and is remembered', () => {
    const s = fixture('noisyLoud')
    wrap(<WaveLinkGuide s={s} />)
    fireEvent.click(screen.getByText('Try AI noise removal first'))
    expect(screen.getByText('Option 1: Elgato Noise Removal (in Wave Link)')).toBeTruthy()
    expect(screen.getByText('ReaFIR: turn the room down')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Use Elgato Noise Removal' }))
    expect(localStorage.getItem(NR_CHOICE_KEY)).toBe('"ai-elgato"')
    expect(screen.queryByText('ReaFIR: turn the room down')).toBeNull()
    expect(screen.getByText(/Elgato Noise Removal stays on/)).toBeTruthy()
    expect(screen.getByText('Listen check')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Use ReaFIR instead' }))
    expect(screen.getByText('ReaFIR: turn the room down')).toBeTruthy()
  })

  it('Wave Link: ReaFIR reduction starts at about 6 dB, never 15 dB', () => {
    wrap(<WaveLinkGuide s={fixture('noisyLoud')} />)
    fireEvent.click(screen.getByText('ReaFIR: turn the room down'))
    expect(screen.getByText('Drag the whole curve down a little: about 6 dB.')).toBeTruthy()
    expect(screen.queryByText(/15 dB/)).toBeNull()
    fireEvent.click(screen.getByText('Test it'))
    // no control takes yet: the default distance
    expect(screen.getByText(/^Record at the same distance as your best take: 8 cm/)).toBeTruthy()
  })

  it('OBS: noisy room adds Noise Suppression and an Expander', () => {
    wrap(<ObsGuide s={fixture('noisyCondenserSide')} />)
    expect(screen.getByText('Noise Suppression')).toBeTruthy()
    expect(screen.getByText('Expander')).toBeTruthy()
    expect(screen.getByText('Limiter')).toBeTruthy()
  })
})
