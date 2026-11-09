import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import i18n from '../../i18n'
import { useBench } from '../../store/benchStore'
import { theme } from '../../theme'
import { GoalLine } from './GoalLine'

vi.mock('../../storage/takesDb', () => ({
  openTakesDb: async () => ({ available: true, all: async () => [], put: async () => undefined, remove: async () => undefined, clear: async () => undefined }),
}))
vi.mock('../../store/engine', () => ({ getEngine: () => ({ sampleRate: 48000, isSupported: () => true }) }))

const setGoal = vi.fn()

beforeAll(async () => {
  await i18n.changeLanguage('en')
})
beforeEach(() => {
  setGoal.mockReset()
  useBench.setState({ goal: { style: 'warm', perceived: ['nasal'] }, setGoal })
})
afterEach(cleanup)

const renderLine = () =>
  render(
    <ThemeProvider theme={theme}>
      <GoalLine />
    </ThemeProvider>,
  )

describe('GoalLine', () => {
  it('shows the goal and what you hear', () => {
    renderLine()
    expect(screen.getByText('Your goal: Warm and deep · you hear: nasal')).toBeTruthy()
  })

  it('shows only the goal when nothing is heard', () => {
    useBench.setState({ goal: { style: 'natural', perceived: [] } })
    renderLine()
    expect(screen.getByText('Your goal: Natural')).toBeTruthy()
  })

  it('"Change goal" opens a dialog that edits the goal and closes with Done', async () => {
    renderLine()
    fireEvent.click(screen.getByRole('button', { name: 'Change goal' }))
    const dialog = screen.getByRole('dialog', { name: 'Change your goal' })
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Bright' }))
    expect(setGoal).toHaveBeenCalledWith({ style: 'bright' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})
