import { beforeEach, describe, expect, it } from 'vitest'
import { suggest, suggestionToJson } from '../../settings/suggest'
import { SHEET_FIXTURES } from '../../settings/sheetFixtures'
import type { Refinement, Suggestion } from '../../types'
import { overrideSuggestion, useGuideOverride } from './guideOverride'
import { loadNrChoice, NR_CHOICE_KEY } from './nrChoice'
import { guideChain } from './waveLinkSteps'

const fixture = (name: string): Suggestion => {
  const [take, dist] = SHEET_FIXTURES[name]
  return suggest(take, dist)!
}

beforeEach(() => {
  localStorage.removeItem(NR_CHOICE_KEY)
  useGuideOverride.setState({ refined: null })
})

describe('guide override (refined settings shown by the guide)', () => {
  it('replaces the values the guide shows and keeps the EQ reasons of unchanged bands', () => {
    const s = fixture('noisyCondenserSide')
    const json = suggestionToJson(s)
    const settings = { ...json, comp: { ...json.comp, wet: json.comp.wet + 6 }, gate: { ...json.gate, threshold: -72 } }
    const o = overrideSuggestion(s, { settings, noiseRemoval: 'reafir', dist: '2 cm', attempt: 2 })
    expect(o.comp.wet).toBe(s.comp.wet + 6)
    expect(o.gate.threshold).toBe(-72)
    expect(o.dist).toBe('2 cm')
    expect(o.eq.map((e) => e.why)).toEqual(s.eq.map((e) => e.why))
    expect(guideChain(o, null)).toContain('ReaFIR')
  })

  it('an AI route saves the noise-remover choice so the Wave Link path skips ReaFIR', () => {
    const s = fixture('noisyCondenserSide')
    const r: Refinement = { settings: suggestionToJson(s), changes: [], noiseRemoval: 'ai-elgato', dist: '2 cm', changeApproach: false }
    useGuideOverride.getState().set(r, 3)
    const refined = useGuideOverride.getState().refined!
    expect(refined.attempt).toBe(3)
    expect(loadNrChoice()).toBe('ai-elgato')
    expect(guideChain(overrideSuggestion(s, refined), loadNrChoice())).not.toContain('ReaFIR')
  })
})
