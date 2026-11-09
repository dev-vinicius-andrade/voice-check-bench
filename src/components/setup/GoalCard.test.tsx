import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import i18n from '../../i18n'
import results from '../../i18n/locales/en/results.json'
import wizard from '../../i18n/locales/en/wizard.json'
import { useBench } from '../../store/benchStore'
import { theme } from '../../theme'
import { DEFAULT_GOAL, type VoiceGoal } from '../../types'
import { PERCEIVED, STYLES } from '../common/goalTarget'
import { GoalCard } from './GoalCard'

vi.mock('../../storage/takesDb', () => ({
  openTakesDb: async () => ({ available: true, all: async () => [], put: async () => undefined, remove: async () => undefined, clear: async () => undefined }),
}))
vi.mock('../../store/engine', () => ({ getEngine: () => ({ sampleRate: 48000, isSupported: () => true }) }))

const setGoal = vi.fn()
const withGoal = (goal: VoiceGoal): void => useBench.setState({ goal, setGoal })

beforeAll(async () => {
  await i18n.changeLanguage('en')
})
beforeEach(() => {
  setGoal.mockReset()
  withGoal(DEFAULT_GOAL)
})
afterEach(cleanup)

const renderCard = () =>
  render(
    <ThemeProvider theme={theme}>
      <GoalCard />
    </ThemeProvider>,
  )

const lookup = (root: unknown, key: string): unknown =>
  key.split('.').reduce<unknown>((n, p) => (n !== null && typeof n === 'object' ? (n as Record<string, unknown>)[p] : undefined), root)

describe('GoalCard', () => {
  it('shows four style cards as a radio group with natural selected', () => {
    renderCard()
    const group = screen.getByRole('radiogroup', { name: 'What do you want your voice to sound like?' })
    expect(group).toBeTruthy()
    expect(screen.getAllByRole('radio')).toHaveLength(4)
    expect((screen.getByRole('radio', { name: 'Natural' }) as HTMLInputElement).checked).toBe(true)
  })

  it('picking a style calls setGoal with that style', () => {
    renderCard()
    fireEvent.click(screen.getByRole('radio', { name: 'Warm and deep' }))
    expect(setGoal).toHaveBeenCalledWith({ style: 'warm' })
  })

  it('chips toggle perceived issues', () => {
    renderCard()
    const nasal = screen.getByRole('button', { name: 'nasal' })
    expect(nasal.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(nasal)
    expect(setGoal).toHaveBeenLastCalledWith({ perceived: ['nasal'] })
    cleanup()
    withGoal({ style: 'natural', perceived: ['nasal', 'dull'] })
    renderCard()
    expect(screen.getByRole('button', { name: 'nasal' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'nasal' }))
    expect(setGoal).toHaveBeenLastCalledWith({ perceived: ['dull'] })
  })

  it('"I\'m not sure" clears what you hear', () => {
    withGoal({ style: 'clear', perceived: ['harsh', 'thin'] })
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: "I'm not sure" }))
    expect(setGoal).toHaveBeenCalledWith({ perceived: [] })
  })

  it('has every goal key in the English source', () => {
    const keys = [
      ...['title', 'hearTitle', 'notSure', 'helper'].map((k) => `wizard.goal.${k}`),
      ...STYLES.flatMap((s) => [`wizard.goal.style.${s}.name`, `wizard.goal.style.${s}.desc`]),
      ...PERCEIVED.map((p) => `wizard.goal.perceived.${p}`),
    ]
    expect(keys.filter((k) => typeof lookup(wizard, k) !== 'string')).toEqual([])
    const res = ['zeroTarget', 'zeroReference', 'targetLegend'].map((k) => `results.chart.${k}`)
    expect(res.filter((k) => typeof lookup(results, k) !== 'string')).toEqual([])
  })
})
