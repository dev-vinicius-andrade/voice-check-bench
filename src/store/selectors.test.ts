import { describe, expect, it } from 'vitest'
import { fakeAnalysis } from '../audio/testSignals'
import type { BenchState } from './api'
import { initialBenchState } from './benchStore'
import {
  selectBestControl,
  selectCanGoNext,
  selectFxDist,
  selectSlots,
  selectSuggestion,
  selectTakeGroups,
} from './selectors'
import type { AnalysisResult, StepKey, Take } from '../types'

const BOOMY_REL = [-18, 8, -1, 2, 0, -6, -7, -11, -17]
const mkTake = (id: number, session: string, step: StepKey | null, analysis: AnalysisResult = fakeAnalysis()): Take => ({
  id,
  name: `take ${id}`,
  session,
  step,
  device: 'Mic',
  sampleRate: 48000,
  samples: new Float32Array(16),
  created: new Date(id).toISOString(),
  analysis,
})

const state = (over: Partial<BenchState>): BenchState => ({ ...initialBenchState(), session: 's1', ...over })
const boomy = () => fakeAnalysis({ rel: BOOMY_REL })

describe('selectSlots', () => {
  it('keeps the latest take per step of the session', () => {
    const s = state({
      takes: [mkTake(5, 's1', 'c8'), mkTake(9, 's1', 'c8'), mkTake(7, 's1', 'c8'), mkTake(20, 's2', 'c8'), mkTake(3, 's1', 'fx')],
    })
    expect(selectSlots(s).map((t) => t?.id ?? null)).toEqual([null, 9, null, 3])
    expect(selectSlots(s, 's2').map((t) => t?.id ?? null)).toEqual([null, 20, null, null])
  })
})

describe('selectFxDist / selectBestControl', () => {
  it('uses fxDist, else the best control distance, else 8 cm', () => {
    expect(selectFxDist(state({}))).toBe('8 cm')
    const takes = [mkTake(1, 's1', 'c2', boomy()), mkTake(2, 's1', 'c15')]
    expect(selectBestControl(state({ takes }))?.take.id).toBe(2)
    expect(selectFxDist(state({ takes }))).toBe('15 cm')
    expect(selectFxDist(state({ takes, fxDist: '2 cm' }))).toBe('2 cm')
  })
})

describe('selectSuggestion fallback order', () => {
  const controls = [mkTake(1, 's1', 'c2', boomy()), mkTake(2, 's1', 'c8', boomy()), mkTake(3, 's1', 'c15')]

  it('prefers the raw take at fxDist', () => {
    expect(selectSuggestion(state({ takes: controls, fxDist: '8 cm' }))?.base.id).toBe(2)
  })

  it('falls back to the best control', () => {
    expect(selectSuggestion(state({ takes: controls }))?.base.id).toBe(3)
  })

  it('falls back to take A when it is an analyzed raw control', () => {
    const takes = [mkTake(4, 's1', 'c8')]
    expect(selectSuggestion(state({ takes }))).toBeNull()
    expect(selectSuggestion(state({ takes, A: 4 }))?.base.id).toBe(4)
  })

  it('uses the session of take A', () => {
    const takes = [...controls, mkTake(10, 's2', 'fx')]
    expect(selectSuggestion(state({ takes, session: 's2', A: 3 }))?.base.id).toBe(3)
    expect(selectSuggestion(state({ takes, session: 's2', A: 10 }))).toBeNull()
  })

  it('returns null for a free take A or an unanalyzed control', () => {
    expect(selectSuggestion(state({ takes: [mkTake(5, 'free', null)], A: 5 }))).toBeNull()
    expect(selectSuggestion(state({ takes: [mkTake(6, 's1', 'c8', { error: 'x' })], A: 6 }))).toBeNull()
  })
})

describe('selectTakeGroups', () => {
  it('orders sessions newest first and takes oldest first', () => {
    const takes = [mkTake(1, 's1', 'c2'), mkTake(5, 'free', null), mkTake(3, 's1', 'c8'), mkTake(2, 's0', 'c2')]
    const g = selectTakeGroups(state({ takes }))
    expect(g.map((x) => x.session)).toEqual(['free', 's1', 's0'])
    expect(g[0].created).toBeNull()
    // a session starts at its first take ('created' of take 1 = 1 ms after the epoch)
    expect(g[1].created).toBe(1)
    expect(g[2].created).toBe(2)
    expect(g.map((x) => x.current)).toEqual([false, true, false])
    expect(g[1].takes.map((t) => t.id)).toEqual([1, 3])
  })
})

describe('selectCanGoNext', () => {
  it('needs an analyzed take for the step and an idle recorder', () => {
    expect(selectCanGoNext(state({ step: 1 }))).toBe(false)
    expect(selectCanGoNext(state({ step: 1, takes: [mkTake(1, 's1', 'c8', { error: 'x' })] }))).toBe(false)
    const ok = state({ step: 1, takes: [mkTake(1, 's1', 'c8')] })
    expect(selectCanGoNext(ok)).toBe(true)
    expect(selectCanGoNext({ ...ok, recorder: { phase: 'reading', elapsed: 4 } })).toBe(false)
    expect(selectCanGoNext(state({ step: 'free', takes: [mkTake(1, 'free', null)], lastTakeId: 1 }))).toBe(true)
  })
})
