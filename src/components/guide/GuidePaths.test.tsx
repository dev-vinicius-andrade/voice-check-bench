import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import i18n from '../../i18n'
import { suggest } from '../../settings/suggest'
import { SHEET_FIXTURES } from '../../settings/sheetFixtures'
import { theme } from '../../theme'
import type { Suggestion } from '../../types'
import { ObsGuide } from './ObsGuide'
import { WaveLinkGuide } from './WaveLinkGuide'
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

  it('OBS: noisy room adds Noise Suppression and an Expander', () => {
    wrap(<ObsGuide s={fixture('noisyCondenserSide')} />)
    expect(screen.getByText('Noise Suppression')).toBeTruthy()
    expect(screen.getByText('Expander')).toBeTruthy()
    expect(screen.getByText('Limiter')).toBeTruthy()
  })
})
