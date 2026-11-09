import { describe, expect, it } from 'vitest'
import { fakeAnalysis } from '../audio/testSignals'
import { DEFAULT_GOAL, type PerceivedIssue, type VoiceGoal } from '../types'
import { PERCEIVED_BOOST, nextActions } from './actions'
import { compareProcessed } from './compare'
import { PERCEIVED_ISSUES, fusePerceived, perceivedNotes } from './perceived'
import { plainRatings, voiceState } from './ratings'
import { clarityScore, penalties } from './score'
import { fixtureAnalyses, mic, processedPair, voiceAnalysis } from './testFixtures'

const goal = (perceived: PerceivedIssue[], style: VoiceGoal['style'] = 'natural'): VoiceGoal => ({ style, perceived })

describe('natural goal', () => {
  it('scores, rates and advises exactly as without a goal', () => {
    for (const a of fixtureAnalyses()) {
      expect(clarityScore(a, { goal: DEFAULT_GOAL })).toEqual(clarityScore(a))
      expect(plainRatings(a, { goal: DEFAULT_GOAL })).toEqual(plainRatings(a))
      for (const hasSuggestion of [true, false]) {
        const ctx = { mic: mic(), bestDist: '8 cm', currentDist: '15 cm', hasSuggestion }
        expect(nextActions(a, { ...ctx, goal: DEFAULT_GOAL })).toEqual(nextActions(a, ctx))
      }
    }
    const { raw, fx } = processedPair()
    expect(clarityScore(fx, { raw, goal: DEFAULT_GOAL })).toEqual(clarityScore(fx, { raw }))
  })
})

describe('style goals', () => {
  it('warm: a boomy take is penalized less and its voice rating is on target', () => {
    const boomy = voiceAnalysis(1, 5)
    const warm = goal([], 'warm')
    expect(penalties(boomy, { goal: warm }).tone).toBeLessThan(penalties(boomy).tone)
    expect(clarityScore(boomy, { goal: warm }).score).toBeGreaterThanOrEqual(clarityScore(boomy).score)
    expect(voiceState(boomy).label).toBe('boomy')
    expect(voiceState(boomy, warm).label).toBe('natural')
  })

  it('clear: the same flat voice reads 3 dB short of the presence target', () => {
    expect(voiceState(fakeAnalysis(), goal([], 'clear')).dev).toBeCloseTo(-3, 10)
  })

  it('processed-vs-raw regressions ignore the goal (they compare raw and processed tone)', () => {
    const { raw, fx } = processedPair()
    const base = compareProcessed(raw, fx).regressions.length
    const p = penalties(fx, { raw, goal: goal([], 'warm') })
    expect(p.overprocessed).toBeGreaterThanOrEqual(10 * base)
    expect(penalties(fx, { raw }).overprocessed).toBe(p.overprocessed)
  })
})

describe('fusePerceived', () => {
  it('confirms nasal when body or definition is > 1.5 dB over the target', () => {
    expect(fusePerceived(voiceAnalysis(4, 5), goal(['nasal']))).toEqual([{ issue: 'nasal', confirmed: true, delta: expect.closeTo(5, 6) }])
    expect(fusePerceived(voiceAnalysis(5, 3), goal(['nasal']))[0].confirmed).toBe(true)
    expect(fusePerceived(fakeAnalysis(), goal(['nasal']))[0]).toMatchObject({ issue: 'nasal', confirmed: false })
    expect(fusePerceived(voiceAnalysis(4, 1.4), goal(['nasal']))[0].confirmed).toBe(false)
  })

  it('checks every issue against its bands', () => {
    const on = (a: ReturnType<typeof fakeAnalysis>, i: PerceivedIssue): boolean => fusePerceived(a, goal([i]))[0].confirmed
    expect(on(voiceAnalysis(3, 4), 'muffled')).toBe(true)
    expect(on(voiceAnalysis(6, -4), 'muffled')).toBe(true)
    expect(on(voiceAnalysis(1, 4), 'boomy')).toBe(true)
    expect(on(voiceAnalysis(2, -6), 'thin')).toBe(true)
    expect(on(voiceAnalysis(6, 4), 'harsh')).toBe(true)
    expect(on(voiceAnalysis(7, 4), 'sharpS')).toBe(true)
    expect(on(fakeAnalysis({ sibP95: -3 }), 'sharpS')).toBe(true)
    expect(on(voiceAnalysis(8, -6), 'dull')).toBe(true)
    for (const i of PERCEIVED_ISSUES) expect(on(fakeAnalysis(), i), i).toBe(false)
  })

  it('a warm goal moves the target: the same boom is no longer confirmed as boomy', () => {
    expect(fusePerceived(voiceAnalysis(1, 4), goal(['boomy']))[0].confirmed).toBe(true)
    expect(fusePerceived(voiceAnalysis(1, 4), goal(['boomy'], 'warm'))[0].confirmed).toBe(false)
  })

  it('drops unknown and repeated issues and gives notes for both cases', () => {
    const g = { style: 'natural', perceived: ['nasal', 'nasal', 'loud' as PerceivedIssue, 'dull'] } as VoiceGoal
    expect(fusePerceived(fakeAnalysis(), g).map((f) => f.issue)).toEqual(['nasal', 'dull'])
    expect(perceivedNotes(voiceAnalysis(4, 5), goal(['nasal', 'dull'])).map((m) => m.key)).toEqual([
      'plain.perceived.confirmed.nasal',
      'plain.perceived.byEar.dull',
    ])
    expect(fusePerceived(fakeAnalysis(), DEFAULT_GOAL)).toEqual([])
  })
})

describe('perceived issues in "What to do next"', () => {
  const ctx = { mic: mic(), bestDist: '8 cm', currentDist: '8 cm', hasSuggestion: true }

  it('confirmed nasal puts the EQ settings first, with a boosted impact', () => {
    const a = voiceAnalysis(4, 5)
    expect(nextActions(a, ctx).map((x) => x.id)).not.toContain('eqSettings')
    const out = nextActions(a, { ...ctx, goal: goal(['nasal']) })
    expect(out[0].id).toBe('eqSettings')
    expect(out[0].impact).toBeGreaterThanOrEqual(PERCEIVED_BOOST)
    expect(out.map((x) => x.id)).not.toContain('eqByEar')
  })

  it('not confirmed: only the gentle by-ear tweak, last', () => {
    const out = nextActions(fakeAnalysis(), { ...ctx, goal: goal(['nasal']) })
    expect(out.map((x) => x.id)).toEqual(['eqByEar'])
    expect(out[0].text.key).toBe('plain.action.eqByEar')
    expect(nextActions(fakeAnalysis(), { ...ctx, hasSuggestion: false, goal: goal(['nasal']) })).toEqual([])
  })

  it('a confirmed boomy voice raises "back off" above the noise actions', () => {
    const a = voiceAnalysis(1, 5, { snr: 22, noiseKind: 'broadband' })
    // measured only: "back off" is outranked by the three noise actions
    expect(nextActions(a, ctx).map((x) => x.id)).not.toContain('backOff')
    const heard = nextActions(a, { ...ctx, goal: goal(['boomy']) })
    expect(heard[0].id).toBe('backOff')
    expect(heard[0].impact).toBeCloseTo(penalties(a).tone + PERCEIVED_BOOST, 10)
  })
})
