import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import '../../i18n'
import i18n from '../../i18n'
import { DEMO_SESSION, buildDemoTakes } from '../../demo/demoTakes'
import { useDemo } from '../../demo/demoSession'
import { prepareResults, useBench } from '../../store/benchStore'
import { theme } from '../../theme'
import { isAnalysisError, type Take } from '../../types'
import { GainHow } from './HowPanels'
import { ResultsScreen } from './ResultsScreen'

vi.mock('../../storage/takesDb', () => ({
  openTakesDb: async () => ({ available: true, all: async () => [], put: async () => undefined, remove: async () => undefined, clear: async () => undefined }),
}))
vi.mock('../../store/engine', () => ({ getEngine: () => ({ sampleRate: 48000, isSupported: () => true }) }))

let demo: Take[] = []

beforeAll(async () => {
  await i18n.changeLanguage('en')
  demo = buildDemoTakes(1_000_000)
})

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => null })))
  try {
    localStorage.clear()
  } catch {
    // storage blocked
  }
  const state = { ...useBench.getState(), takes: demo, session: DEMO_SESSION, A: null, B: null }
  useBench.setState({ takes: demo, B: null, view: 'a', ...prepareResults(state) })
  useDemo.setState({ active: true, dismissed: false })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const renderResults = () =>
  render(
    <ThemeProvider theme={theme}>
      <ResultsScreen />
    </ThemeProvider>,
  )

describe('ResultsScreen (plain-first layout)', () => {
  it('shows the score ring, three ratings, at most 3 actions and collapsed technical details', async () => {
    renderResults()
    await act(async () => undefined)

    expect(screen.getByText('This is example data — your own takes are not affected.')).toBeTruthy()
    const ring = screen.getByTestId('score-ring')
    expect(ring.getAttribute('aria-label')).toMatch(/^Clarity score: \d+ out of 100$/)
    expect(screen.getByText('Your voice today')).toBeTruthy()

    for (const title of ['Background noise', 'Your volume', 'Sound of your voice']) {
      expect(screen.getByText(title)).toBeTruthy()
    }

    const list = screen.queryByTestId('next-actions')
    const items = list ? within(list).getAllByRole('listitem') : []
    expect(items.length).toBeLessThanOrEqual(3)
    if (!list) expect(screen.getByText("Nothing to fix right now. Keep doing what you're doing.")).toBeTruthy()

    const summary = screen.getByRole('button', { name: 'Show the technical details' })
    expect(summary.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Checks for A')).toBeNull()
  })

  it('opens the technical details on click and remembers it', async () => {
    renderResults()
    await act(async () => undefined)
    fireEvent.click(screen.getByRole('button', { name: 'Show the technical details' }))
    expect(screen.getByRole('button', { name: 'Show the technical details' }).getAttribute('aria-expanded')).toBe('true')
    expect(await screen.findByText('Checks for A')).toBeTruthy()
    expect(localStorage.getItem('vcb-results-details')).toBe('1')
  })

  it('an over-processed take: lower score than without effects, the over-processing headline and a warning list (v0.8)', async () => {
    const takes = demo.map((t): Take => {
      if (t.step !== 'fx' || isAnalysisError(t.analysis)) return t
      const a = t.analysis
      const rel = a.rel.map((v, i) => (i === 1 || i === 2 ? v - 20 : i === 6 ? v + 10 : v))
      return { ...t, analysis: { ...a, rel, noise: -100, snr: a.speechMed - 18 + 100, speechMed: a.speechMed - 18, zeroRatio: 0.4, gateSwitches: 23 } }
    })
    useBench.setState({ takes })
    renderResults()
    await act(async () => undefined)

    expect(screen.getByText("Too much processing: it's cutting your voice")).toBeTruthy()
    const line = screen.getByTestId('score-before-after').textContent ?? ''
    const [before, after] = (line.match(/\d+/g) ?? []).map(Number)
    expect(after).toBeLessThan(before)
    expect(screen.getByText('Cut to silence')).toBeTruthy()
    const alert = screen.getByTestId('regressions-alert')
    expect(within(alert).getByText('Your effects are making your voice worse')).toBeTruthy()
    expect(within(alert).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      // vs the raw control at the processed distance (8 cm, quieter than the demo's processed take before the cut)
      expect.stringMatching(/^Your voice got much quieter \(\d+ dB\)$/),
      'The bass is gone, so your voice sounds thin',
      'The upper tones got harsh and tiring',
      'Pauses are cut to total silence, which chops your words',
    ])
    expect(screen.queryByText(/quieter next to your voice/)).toBeNull()
    const steps = within(screen.getByTestId('next-actions')).getAllByRole('listitem').map((li) => li.textContent ?? '')
    expect(steps[0]).toContain('Turn noise removal down')
    // one raw reference everywhere: the Wet action makes up exactly the level drop the warning lists
    const drop = within(alert).getAllByRole('listitem')[0].textContent?.match(/\d+/)?.[0]
    expect(steps[1]).toContain(`Raise the compressor's Wet by about ${drop} dB`)
  })
})

describe('GainHow / Term', () => {
  it('shows the glossary meaning when the info button is clicked', async () => {
    render(
      <ThemeProvider theme={theme}>
        <GainHow />
      </ThemeProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'What does “Gain” mean?' }))
    expect(await screen.findByText(/How much the mic's signal is turned up/)).toBeTruthy()
  })
})
