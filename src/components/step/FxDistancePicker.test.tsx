import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import i18n from '../../i18n'
import en from '../../i18n/locales/en/wizard.json'
import pt from '../../i18n/locales/pt-BR/wizard.json'
import enResults from '../../i18n/locales/en/results.json'
import ptResults from '../../i18n/locales/pt-BR/results.json'
import { useBench } from '../../store/benchStore'
import { theme } from '../../theme'
import type { AppliedSettings } from '../../types'
import { suggestionFixture } from '../../wavelink/testFixtures'
import { useGuideOverride } from '../guide/guideOverride'
import { MismatchCard } from '../results/LoopCards'
import { FxDistancePicker } from './FxDistancePicker'

vi.mock('../../storage/takesDb', () => ({
  openTakesDb: async () => ({ available: true, all: async () => [], put: async () => undefined, remove: async () => undefined, clear: async () => undefined }),
}))
vi.mock('../../store/engine', () => ({ getEngine: () => ({ sampleRate: 48000, isSupported: () => true }) }))

const applied = (dist: string): AppliedSettings => ({
  id: 'a1', date: '2026-11-09T00:00:00.000Z', settings: suggestionFixture(), noiseRemoval: 'ai-elgato', dist, attempt: 1,
})

const setFxDist = vi.fn()
const goTo = vi.fn()

beforeAll(async () => {
  await i18n.changeLanguage('en')
})
beforeEach(() => {
  setFxDist.mockReset()
  goTo.mockReset()
  useBench.setState({ takes: [], fxDist: '15 cm', applied: null, recorder: { phase: 'idle', elapsed: 0 }, setFxDist, goTo } as never)
})
afterEach(cleanup)

const wrap = (ui: React.ReactElement) => render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)

describe('FxDistancePicker', () => {
  it('offers the three control distances, the current one selected; picking one sets fxDist', () => {
    wrap(<FxDistancePicker />)
    const group = screen.getByRole('group', { name: 'Where are you recording?' })
    const buttons = within(group).getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual([expect.stringMatching(/^2 cm/), expect.stringMatching(/^8 cm/), expect.stringMatching(/^15 cm/)])
    expect(buttons[2].getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(buttons[0])
    expect(setFxDist).toHaveBeenCalledWith('2 cm')
    expect(screen.queryByTestId('fx-distance-mismatch')).toBeNull()
  })

  it('no alert when the applied settings were made for the chosen distance', () => {
    useBench.setState({ applied: applied('15 cm') })
    wrap(<FxDistancePicker />)
    expect(screen.queryByTestId('fx-distance-mismatch')).toBeNull()
  })

  it('an info alert when the applied settings were made for another distance', () => {
    useBench.setState({ applied: applied('2 cm') })
    wrap(<FxDistancePicker />)
    const alert = screen.getByTestId('fx-distance-mismatch')
    expect(alert.textContent).toContain('Your settings were made for 2 cm')
    expect(alert.textContent).toContain('settings made for 15 cm')
  })

  it('is disabled while recording', () => {
    useBench.setState({ recorder: { phase: 'recording', elapsed: 1 } } as never)
    wrap(<FxDistancePicker />)
    for (const b of screen.getAllByRole('button')) expect((b as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('MismatchCard', () => {
  it('"Make settings for 15 cm" drops the refined override, keeps 15 cm and opens the guide', () => {
    useGuideOverride.setState({ refined: { settings: suggestionFixture(), noiseRemoval: 'reafir', dist: '2 cm', attempt: 2 } })
    wrap(<MismatchCard recorded="15 cm" dist="2 cm" />)
    expect(screen.getByRole('button', { name: /Record again at 2/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Make settings for 15/ }))
    expect(useGuideOverride.getState().refined).toBeNull()
    expect(setFxDist).toHaveBeenCalledWith('15 cm')
    expect(goTo).toHaveBeenCalledWith('guide')
  })
})

describe('locale parity (processed distance)', () => {
  it('wizard.fxDist and results.mismatch keys exist in en and pt-BR', () => {
    expect(Object.keys(pt.wizard.fxDist)).toEqual(Object.keys(en.wizard.fxDist))
    expect(Object.keys(ptResults.results.mismatch)).toEqual(Object.keys(enResults.results.mismatch))
    expect(ptResults.results.regressions.tooLoud).toBeTruthy()
  })
})
