import { describe, expect, it } from 'vitest'
import { eqBand } from './testFixtures'
import {
  collectSolutions,
  DEFAULT_SOLUTION_FILTER,
  effectiveMic,
  filterSolutions,
  micsWithSolutions,
  parseSolutionFilter,
  type SolutionFilter,
} from './solutions'
import type { CommunityMicStats, CommunitySolution } from './types'

const suggestion: CommunitySolution['suggestion'] = {
  speechDbfs: -24,
  noiseDbfs: -60,
  gainHint: '',
  noiseHint: '',
  dist: '8 cm',
  lowcut: 80,
  gate: { threshold: -48, attack: 1, hold: 150, release: 200, hysteresis: -6, wet: 0, dry: -20 },
  eq: [eqBand('Low Shelf', 150, -3, 2)],
  comp: { threshold: -30, ratio: 3, attack: 5, release: 100, knee: 6, wet: 4, limit: true },
  deess: false,
  noisyRoom: false,
  noiseReduction: null,
  chain: ['ReaGate', 'ReaEQ', 'ReaComp'],
}

const sol = (issue: number, votes: number, extra: Partial<CommunitySolution> = {}): CommunitySolution => ({
  issue,
  votes,
  style: null,
  noisyRoom: false,
  rawSnr: 30,
  dist: '8 cm',
  snrGain: null,
  suggestion,
  ...extra,
})

const mic = (model: string, key: string, solutions?: CommunitySolution[]): CommunityMicStats => ({
  key,
  model,
  reports: 3,
  kind: 'dynamic',
  pattern: 'cardioid',
  address: 'end',
  rawSnr: { median: 30, p25: 28, p75: 32 },
  noise: { median: -60, p25: -62, p75: -58 },
  deviations: [],
  bestDistance: [],
  processedSnrGain: null,
  eq: [],
  noisyRoomShare: 0,
  ...(solutions ? { solutions } : {}),
})

const MICS = [
  mic('Shure SM7B', 'shuresm7b', [sol(5, 2, { style: 'warm', snrGain: 4 }), sol(9, 2, { noisyRoom: true })]),
  mic('Fifine K688', 'fifinek688', [sol(7, 6, { style: 'clear', noisyRoom: true, snrGain: 9 })]),
  mic('Old Mic', 'oldmic'),
]
const ITEMS = collectSolutions(MICS)
const f = (patch: Partial<SolutionFilter>): SolutionFilter & { mic: string } => ({ ...DEFAULT_SOLUTION_FILTER, ...patch, mic: patch.mic ?? 'all' })

describe('community solutions', () => {
  it('flattens solutions with their mic and skips mics without any', () => {
    expect(ITEMS.map((s) => [s.issue, s.model])).toEqual([[5, 'Shure SM7B'], [9, 'Shure SM7B'], [7, 'Fifine K688']])
    expect(micsWithSolutions(MICS).map((m) => m.key)).toEqual(['fifinek688', 'shuresm7b'])
  })

  it('sorts by votes (newest breaks ties), by improvement (nulls last) and by newest', () => {
    expect(filterSolutions(ITEMS, f({ sort: 'votes' })).map((s) => s.issue)).toEqual([7, 9, 5])
    expect(filterSolutions(ITEMS, f({ sort: 'gain' })).map((s) => s.issue)).toEqual([7, 5, 9])
    expect(filterSolutions(ITEMS, f({ sort: 'newest' })).map((s) => s.issue)).toEqual([9, 7, 5])
  })

  it('filters by mic, style and room', () => {
    expect(filterSolutions(ITEMS, f({ mic: 'shuresm7b' })).map((s) => s.issue)).toEqual([9, 5])
    expect(filterSolutions(ITEMS, f({ style: 'warm' })).map((s) => s.issue)).toEqual([5])
    expect(filterSolutions(ITEMS, f({ room: 'noisy' })).map((s) => s.issue)).toEqual([7, 9])
    expect(filterSolutions(ITEMS, f({ room: 'quiet' })).map((s) => s.issue)).toEqual([5])
    expect(filterSolutions(ITEMS, f({ style: 'bright' }))).toEqual([])
  })

  it('resolves the mic: a chosen mic with solutions, else your own, else all', () => {
    const keys = ['fifinek688', 'shuresm7b']
    expect(effectiveMic('shuresm7b', 'fifinek688', keys)).toBe('shuresm7b')
    expect(effectiveMic('all', 'fifinek688', keys)).toBe('all')
    expect(effectiveMic(null, 'fifinek688', keys)).toBe('fifinek688')
    expect(effectiveMic('gone', 'fifinek688', keys)).toBe('fifinek688')
    expect(effectiveMic(null, 'oldmic', keys)).toBe('all')
  })

  it('reads a stored filter, replacing bad fields with defaults', () => {
    expect(parseSolutionFilter({ mic: 'x', style: 'warm', room: 'noisy', sort: 'gain' })).toEqual({ mic: 'x', style: 'warm', room: 'noisy', sort: 'gain' })
    expect(parseSolutionFilter({ mic: 3, style: 'loud', room: null, sort: 'best' })).toEqual(DEFAULT_SOLUTION_FILTER)
    expect(parseSolutionFilter('nope')).toEqual(DEFAULT_SOLUTION_FILTER)
  })
})
