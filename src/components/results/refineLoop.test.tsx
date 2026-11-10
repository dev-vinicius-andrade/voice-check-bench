import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import i18n from '../../i18n'
import en from '../../i18n/locales/en/results.json'
import pt from '../../i18n/locales/pt-BR/results.json'
import enGuide from '../../i18n/locales/en/guide.json'
import ptGuide from '../../i18n/locales/pt-BR/guide.json'
import { buildDemoTakes, DEMO_SESSION } from '../../demo/demoTakes'
import { evaluateProcessed, refine } from '../../plain/refine'
import { useBench } from '../../store/benchStore'
import { theme } from '../../theme'
import { DEFAULT_GOAL, type AppliedSettings, type Refinement, type Take } from '../../types'
import { suggestionFixture } from '../../wavelink/testFixtures'
import type { WlApplyPlan, WlFile } from '../../wavelink/types'
import { useGuideOverride } from '../guide/guideOverride'
import { AttemptsTimeline } from './AttemptsTimeline'
import { RefineCard } from './RefineCard'
import { RefineLoopPanel } from './RefineLoopPanel'
import { refineLoop, type Attempt, type RefineLoop } from './useRefineLoop'

vi.mock('../../plain/refine', async (orig) => ({
  ...(await orig<typeof import('../../plain/refine')>()),
  evaluateProcessed: vi.fn(),
  refine: vi.fn(),
}))

// The dialog's upload/preview/download flow is covered by WaveLinkApplyDialog.test; here a button stands in for the download.
vi.mock('../wavelink/WaveLinkApplyDialog', () => ({
  WaveLinkApplyDialog: ({ open, buildPlan, onApplied }: { open: boolean; buildPlan(f: WlFile, k: string): WlApplyPlan; onApplied?(p: WlApplyPlan): void }) =>
    open ? <button onClick={() => onApplied?.(buildPlan({} as WlFile, 'mic'))}>mock download</button> : null,
}))

const applied = (attempt: number, over: Partial<AppliedSettings> = {}): AppliedSettings => ({
  id: `a${attempt}`,
  date: '2026-11-09T00:00:00.000Z',
  settings: suggestionFixture(),
  noiseRemoval: 'reafir',
  dist: '2 cm',
  attempt,
  ...over,
})

const refinement = (over: Partial<Refinement> = {}): Refinement => ({
  settings: suggestionFixture({ chain: ['ReaFIR', 'ReaEQ', 'ReaComp', 'ReaGate'] }),
  changes: [
    { reason: 'quieter', msg: { key: 'test.quieter' } },
    { reason: 'chopped', msg: { key: 'test.chopped' } },
  ],
  noiseRemoval: 'ai-elgato',
  dist: '2 cm',
  changeApproach: false,
  ...over,
})

const attempt = (id: number, n: number, rawScore: number, fxScore: number, improved: boolean): Attempt => ({ id, n, rawScore, fxScore, improved, mismatch: null })

const wrap = (ui: React.ReactElement) => render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)

let markApplied: ReturnType<typeof vi.fn>
let demo: Take[] = []

beforeAll(async () => {
  await i18n.changeLanguage('en')
  i18n.addResourceBundle('en', 'translation', { test: { quieter: 'Compressor goes up 12 dB', chopped: 'Gate opens earlier' } }, true, true)
  demo = buildDemoTakes(1_000_000)
})
beforeEach(() => {
  markApplied = vi.fn()
  useBench.setState({ markApplied, goTo: vi.fn(), setFxDist: vi.fn() } as never)
  useGuideOverride.setState({ refined: null })
})
afterEach(() => {
  cleanup()
  vi.mocked(evaluateProcessed).mockReset()
  vi.mocked(refine).mockReset()
})

describe('AttemptsTimeline', () => {
  it('lists each attempt with raw → processed scores and ✓/✗', () => {
    wrap(<AttemptsTimeline attempts={[attempt(1, 1, 35, 0, false), attempt(2, 2, 35, 58, true)]} currentId={2} />)
    const items = within(screen.getByTestId('attempts-timeline')).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0].textContent).toContain('Attempt 1 · 35 → 0')
    expect(items[0].textContent).toContain('✗')
    expect(items[1].textContent).toContain('Attempt 2 · 35 → 58')
    expect(items[1].textContent).toContain('✓')
    expect(items[1].getAttribute('aria-current')).toBe('step')
  })
})

describe('RefineCard', () => {
  it('shows the changes, the route change and the next distance; a download marks attempt + 1 applied', () => {
    wrap(<RefineCard refinement={refinement()} applied={applied(1)} />)
    const card = screen.getByTestId('refine-card')
    expect(within(card).getByText("Let's fix this")).toBeTruthy()
    expect(within(card).getByText('Compressor goes up 12 dB')).toBeTruthy()
    expect(within(card).getByText('Gate opens earlier')).toBeTruthy()
    expect(within(card).getByTestId('refine-route').textContent).toContain('Elgato Noise Removal')
    expect(within(card).getByText(/Record at 2/)).toBeTruthy()

    fireEvent.click(within(card).getByRole('button', { name: 'Apply the refined settings to Wave Link' }))
    fireEvent.click(screen.getByRole('button', { name: 'mock download' }))
    expect(markApplied).toHaveBeenCalledTimes(1)
    const arg = markApplied.mock.calls[0][0]
    expect(arg.attempt).toBe(2)
    expect(arg.noiseRemoval).toBe('ai-elgato')
    expect(arg.dist).toBe('2 cm')
    // AI route: ReaFIR is not part of the applied chain
    expect(arg.settings.chain).not.toContain('ReaFIR')
  })

  it('"I\'ll change them by hand" hands the refined settings to the guide', () => {
    wrap(<RefineCard refinement={refinement()} applied={applied(2)} />)
    fireEvent.click(screen.getByRole('button', { name: "I'll change them by hand" }))
    expect(useGuideOverride.getState().refined?.attempt).toBe(3)
    expect(useBench.getState().goTo).toHaveBeenCalledWith('guide')
  })
})

describe('RefineLoopPanel', () => {
  const loop = (over: Partial<RefineLoop>): RefineLoop => ({
    attempts: [attempt(7, 1, 35, 20, false)],
    current: attempt(7, 1, 35, 20, false),
    applied: applied(1),
    refinement: refinement(),
    ...over,
  })
  const A = { id: 7, session: 's', step: 'fx' } as Take

  it('wrong distance: warning card first, no refine changes', () => {
    const mismatch = { expected: '2 cm', actual: '15 cm', msg: { key: 'x' } }
    wrap(<RefineLoopPanel A={A} loop={loop({ current: { ...attempt(7, 1, 35, 20, false), mismatch }, refinement: null })} />)
    expect(screen.getByTestId('mismatch-card').textContent).toContain('This take was recorded at 15')
    expect(screen.queryByTestId('refine-card')).toBeNull()
  })

  it('change approach: recommends AI noise removal and physical actions instead of tweaks', () => {
    wrap(<RefineLoopPanel A={A} loop={loop({ refinement: refinement({ changeApproach: true }) })} />)
    expect(screen.getByTestId('approach-card')).toBeTruthy()
    expect(screen.queryByTestId('refine-card')).toBeNull()
  })

  it('not improved: shows the refine card', () => {
    wrap(<RefineLoopPanel A={A} loop={loop({})} />)
    expect(screen.getByTestId('refine-card')).toBeTruthy()
    expect(screen.queryByTestId('worked-card')).toBeNull()
  })
})

describe('refineLoop (pure)', () => {
  it('evaluates every processed take with applied settings; refine is skipped on a distance mismatch', () => {
    const fx = demo.find((t) => t.step === 'fx')!
    const takes = [...demo.filter((t) => t !== fx), { ...fx, id: 900, applied: applied(1) }, { ...fx, id: 901, applied: applied(2) }]
    const A = takes[takes.length - 1]
    vi.mocked(evaluateProcessed).mockImplementation((_raw, t) => ({
      improved: false,
      rawScore: 35,
      fxScore: 'id' in t && t.id === 900 ? 0 : 20,
      regressions: [],
      mismatch: 'id' in t && t.id === 901 ? { expected: '2 cm', actual: '15 cm', msg: { key: 'x' } } : null,
      levelDrop: 0,
    }))
    const l = refineLoop(takes, A, DEMO_SESSION, null, DEFAULT_GOAL)
    expect(l?.attempts.map((x) => [x.n, x.fxScore])).toEqual([[1, 0], [2, 20]])
    expect(l?.current.mismatch?.actual).toBe('15 cm')
    expect(l?.refinement).toBeNull()
    expect(refine).not.toHaveBeenCalled()
  })
})

describe('locale parity (loop keys)', () => {
  const keys = (o: object, p = ''): string[] =>
    Object.entries(o).flatMap(([k, v]) => (typeof v === 'string' ? [`${p}${k}`] : keys(v as object, `${p}${k}.`)))
  it('results and guide loop keys exist in en and pt-BR', () => {
    for (const area of ['attempts', 'refine', 'mismatch', 'approach', 'worked'] as const) {
      expect(keys(pt.results[area])).toEqual(keys(en.results[area]))
    }
    expect(keys(ptGuide.guide.refined)).toEqual(keys(enGuide.guide.refined))
    expect(ptGuide.guide.wl.markApplied).toBeTruthy()
  })
})
