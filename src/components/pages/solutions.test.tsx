import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import i18n from '../../i18n'
import { useBench } from '../../store/benchStore'
import { theme } from '../../theme'
import { eqBand } from '../../community/testFixtures'
import type { CommunityMicStats, CommunitySolution } from '../../community/types'
import { overrideSuggestion, useGuideOverride } from '../guide/guideOverride'
import { RefinedBanner } from '../guide/RefinedBanner'
import { SolutionCard } from './SolutionCard'
import { SolutionsSection } from './SolutionsSection'
import { SOLUTION_FILTER_KEY } from './useSolutionFilter'
import type { Suggestion } from '../../types'
import { SOLUTION_ROOMS, SOLUTION_SORTS, SOLUTION_STYLES } from '../../community/solutions'

vi.mock('../../storage/takesDb', () => ({
  openTakesDb: async () => ({ available: true, all: async () => [], put: async () => undefined, remove: async () => undefined, clear: async () => undefined }),
}))
vi.mock('../../store/engine', () => ({ getEngine: () => ({ sampleRate: 48000, isSupported: () => true }) }))

const suggestion: CommunitySolution['suggestion'] = {
  speechDbfs: -24,
  noiseDbfs: -60,
  gainHint: '',
  noiseHint: '',
  dist: '8 cm',
  lowcut: 80,
  gate: { threshold: -48, attack: 1, hold: 150, release: 200, hysteresis: -6, wet: 0, dry: -20 },
  eq: [eqBand('Low Shelf', 150, -3, 2), eqBand('Band', 3000, 2.5, 1)],
  comp: { threshold: -30, ratio: 3, attack: 5, release: 100, knee: 6, wet: 4, limit: true },
  deess: false,
  noisyRoom: true,
  noiseReduction: { plugin: 'ReaFIR', steps: [], alternatives: [], preferAi: false },
  chain: ['ReaFIR', 'ReaEQ', 'ReaComp', 'ReaGate'],
}

const sol = (issue: number, votes: number, extra: Partial<CommunitySolution> = {}): CommunitySolution => ({
  issue, votes, style: null, noisyRoom: false, rawSnr: 30, dist: '8 cm', snrGain: null, suggestion, ...extra,
})

const mic = (model: string, key: string, solutions?: CommunitySolution[]): CommunityMicStats => ({
  key, model, reports: 3, kind: 'dynamic', pattern: 'cardioid', address: 'end',
  rawSnr: { median: 30, p25: 28, p75: 32 }, noise: { median: -60, p25: -62, p75: -58 },
  deviations: [], bestDistance: [], processedSnrGain: null, eq: [], noisyRoomShare: 0,
  ...(solutions ? { solutions } : {}),
})

const MICS = [
  mic('Shure SM7B', 'shuresm7b', [sol(5, 2, { style: 'warm' }), sol(9, 1)]),
  mic('Fifine K688', 'fifinek688', [sol(7, 6, { style: 'clear', noisyRoom: true, snrGain: 9 })]),
]

const wrap = (ui: React.ReactNode) => render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
const cards = () => screen.queryAllByTestId('solution-card')

beforeAll(async () => {
  await i18n.changeLanguage('en')
})
beforeEach(() => {
  localStorage.clear()
  useGuideOverride.getState().clear()
  useBench.setState({ micProfile: { model: '', kind: 'dynamic', pattern: 'cardioid', address: 'end' }, applied: null })
})
afterEach(cleanup)

describe('SolutionCard', () => {
  it('shows votes, chips, a settings summary and the GitHub vote link', () => {
    wrap(<SolutionCard s={sol(7, 6, { style: 'clear', noisyRoom: true, snrGain: 9 })} model="Fifine K688" canUse={false} />)
    const card = screen.getByTestId('solution-card')
    expect(within(card).getByText('Fifine K688')).toBeTruthy()
    expect(within(card).getByLabelText('6 people found this helpful')).toBeTruthy()
    for (const chip of ['Clear and present', 'Noisy room', 'Voice +9 dB clearer over the room']) expect(within(card).getByText(chip)).toBeTruthy()
    expect(within(card).getByText(/^Mic at 8 cm/)).toBeTruthy()
    const settings = within(screen.getByTestId('solution-settings'))
    expect(settings.getByText('Low Shelf 150 Hz -3 dB')).toBeTruthy()
    expect(settings.getByText('Band 3000 Hz +2.5 dB')).toBeTruthy()
    expect(settings.getByText('starts at -30 dB, ratio 3:1')).toBeTruthy()
    expect(settings.getByText('opens at -48 dB')).toBeTruthy()
    expect(settings.getByText('On')).toBeTruthy()
    const vote = within(card).getByRole('link', { name: '👍 Vote on GitHub' })
    expect(vote.getAttribute('href')).toBe('https://github.com/dev-vinicius-andrade/voice-check-bench/issues/7')
    expect(vote.getAttribute('target')).toBe('_blank')
    expect(vote.getAttribute('rel')).toContain('noopener')
    expect(within(card).queryByRole('button', { name: 'Use these settings' })).toBeNull()
    expect(card.textContent).not.toMatch(/pages\.|wizard\./)
  })

  it('"Use these settings" opens the guide with the shared settings as the next attempt', () => {
    const goTo = vi.fn()
    const setFxDist = vi.fn()
    useBench.setState({ goTo, setFxDist, applied: { id: 'a', date: '', settings: { ...suggestion, basedOn: 'x' }, noiseRemoval: 'none', dist: '2 cm', attempt: 2 } })
    wrap(<SolutionCard s={sol(7, 6)} canUse />)
    expect(screen.getByText('Shared settings #7')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Use these settings' }))
    const refined = useGuideOverride.getState().refined
    expect(refined).toMatchObject({ attempt: 3, dist: '8 cm', noiseRemoval: 'reafir' })
    expect(refined?.settings.basedOn).toBe('community #7')
    expect(setFxDist).toHaveBeenCalledWith('8 cm')
    expect(goTo).toHaveBeenCalledWith('guide')
    cleanup()
    // the guide banner says these came from the community, and new EQ bands say so too
    wrap(<RefinedBanner />)
    expect(screen.getByText('Settings shared by the community (#7)')).toBeTruthy()
    const s = { eq: [] } as unknown as Suggestion
    expect(refined && overrideSuggestion(s, refined).eq[0].why).toEqual({ key: 'guide.refined.communityEqWhy' })
  })
})

describe('SolutionsSection', () => {
  it('says nothing is shared yet when the index has no solutions', () => {
    wrap(<SolutionsSection mics={[mic('Old Mic', 'oldmic')]} />)
    expect(screen.getByTestId('solutions-none').textContent).toContain('No shared settings yet.')
    expect(screen.getByRole('button', { name: 'See how to share yours' })).toBeTruthy()
    expect(screen.queryByTestId('solution-filters')).toBeNull()
  })

  it('lists every mic by votes, with the mic name, when the saved mic has no solutions', () => {
    wrap(<SolutionsSection mics={MICS} />)
    expect(cards().map((c) => c.querySelector('p')?.textContent)).toEqual(['Fifine K688', 'Shure SM7B', 'Shure SM7B'])
  })

  it('starts on the saved mic when it has solutions', () => {
    useBench.setState({ micProfile: { model: 'fifine k688', kind: 'dynamic', pattern: 'cardioid', address: 'end' } })
    wrap(<SolutionsSection mics={MICS} />)
    expect(cards()).toHaveLength(1)
    expect(screen.queryByText('Fifine K688', { selector: 'p' })).toBeNull()
  })

  it('shows "nothing matches" with a working "Clear filters", and remembers the filter', () => {
    localStorage.setItem(SOLUTION_FILTER_KEY, JSON.stringify({ mic: 'shuresm7b', style: 'bright', room: 'any', sort: 'votes' }))
    wrap(<SolutionsSection mics={MICS} />)
    expect(screen.getByText('Nothing matches these filters.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(cards()).toHaveLength(3)
    expect(JSON.parse(localStorage.getItem(SOLUTION_FILTER_KEY) ?? '{}')).toMatchObject({ mic: 'all', style: 'any', room: 'any' })
    fireEvent.click(screen.getByRole('button', { name: 'Noisy' }))
    expect(cards()).toHaveLength(1)
  })

  it('shows 10 cards and "Show more" adds the rest', () => {
    const many = Array.from({ length: 12 }, (_, i) => sol(100 + i, i))
    wrap(<SolutionsSection mics={[mic('Shure SM7B', 'shuresm7b', many)]} />)
    expect(cards()).toHaveLength(10)
    fireEvent.click(screen.getByRole('button', { name: 'Show more (2 left)' }))
    expect(cards()).toHaveLength(12)
    expect(screen.queryByRole('button', { name: /Show more/ })).toBeNull()
  })

  it('works when localStorage is blocked', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    wrap(<SolutionsSection mics={MICS} />)
    fireEvent.click(screen.getByRole('button', { name: 'Quiet' }))
    expect(cards()).toHaveLength(2)
    get.mockRestore()
    set.mockRestore()
  })
})

describe('shared settings keys', () => {
  it('every room, sort and style label exists in both languages', () => {
    const keys = [
      ...SOLUTION_ROOMS.map((r) => `pages.community.solutions.room.${r}`),
      ...SOLUTION_SORTS.map((x) => `pages.community.solutions.sort.${x}`),
      ...SOLUTION_STYLES.map((x) => `wizard.goal.style.${x}.name`),
    ]
    for (const lng of ['en', 'pt-BR']) expect(keys.filter((k) => !i18n.exists(k, { lng }))).toEqual([])
  })
})
