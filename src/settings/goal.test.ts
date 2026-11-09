// Voice goals (v0.9) in the suggested settings: natural = byte-identical to before, styles move the EQ target,
// perceived issues add a nasal band or a gentle by-ear tweak.
import { describe, expect, it } from 'vitest'
import { fakeAnalysis } from '../audio/testSignals'
import { voiceAnalysis } from '../plain/testFixtures'
import { bestControl } from '../session/bestControl'
import { DEFAULT_GOAL, type Analysis, type PerceivedIssue, type StepKey, type Take, type VoiceGoal } from '../types'
import golden from './golden/sheets.json'
import { SHEET_FIXTURES } from './sheetFixtures'
import { BY_EAR_DB, suggest, suggestionToJson, suggestionToText } from './suggest'

const GOLDEN = golden as Record<string, { text: string; json: string }>
const take = (analysis: Analysis, step: StepKey = 'c8', id = 1): Take => ({
  id, name: 'Control · 8 cm · raw', session: 's1', step, device: 'Mic', sampleRate: 48000,
  samples: new Float32Array(0), created: '2026-01-01T00:00:00.000Z', analysis,
})
const goal = (perceived: PerceivedIssue[], style: VoiceGoal['style'] = 'natural'): VoiceGoal => ({ style, perceived })
const eqOf = (a: Analysis, g: VoiceGoal) => suggest(take(a), '8 cm', undefined, g)?.eq ?? []

describe('natural goal', () => {
  for (const name of Object.keys(SHEET_FIXTURES)) {
    it(`${name}: sheet and JSON stay byte-identical`, () => {
      const [t, d] = SHEET_FIXTURES[name]
      const s = suggest(t, d, t.mic, DEFAULT_GOAL)
      if (!s) throw new Error('no suggestion')
      expect(suggestionToText(s)).toBe(GOLDEN[name].text)
      expect(JSON.stringify(suggestionToJson(s), null, 2)).toBe(GOLDEN[name].json)
    })
  }

  it('best control is the same with and without the natural goal', () => {
    const slots = [take(voiceAnalysis(1, 6), 'c2', 1), take(fakeAnalysis(), 'c8', 2), take(voiceAnalysis(1, -6), 'c15', 3), null]
    expect(bestControl(slots, DEFAULT_GOAL)).toEqual(bestControl(slots))
  })
})

describe('style goals', () => {
  it('warm: a boomy take gets a smaller low-shelf cut', () => {
    const boomy = voiceAnalysis(1, 5)
    const shelf = (g: VoiceGoal) => eqOf(boomy, g).find((e) => e.type === 'Low Shelf')?.gain ?? 0
    expect(shelf(DEFAULT_GOAL)).toBe(-3.5)
    expect(shelf(goal([], 'warm'))).toBe(-1.5)
  })

  it('clear: the presence target is higher, so a flat voice gets a presence lift', () => {
    const presence = (g: VoiceGoal) => eqOf(fakeAnalysis(), g).find((e) => e.freq === 3500)?.gain ?? 0
    expect(presence(DEFAULT_GOAL)).toBe(0)
    expect(presence(goal([], 'clear'))).toBe(2)
  })

  it('best control follows the target: warm prefers the take with more bass', () => {
    const slots = [take(voiceAnalysis(1, 3), 'c2', 1), take(fakeAnalysis(), 'c8', 2), take(voiceAnalysis(1, -6), 'c15', 3), null]
    expect(bestControl(slots)?.dist).toBe('8 cm')
    expect(bestControl(slots, goal([], 'warm'))?.dist).toBe('2 cm')
  })
})

describe('perceived nasal', () => {
  it('confirmed: a -2..-4 dB band at 900-1600 Hz, bw 1.0, replacing the body cut', () => {
    const eq = eqOf(voiceAnalysis(4, 5), goal(['nasal']))
    const nasal = eq.filter((e) => e.why.key === 'suggestx.why.nasal')
    expect(nasal).toHaveLength(1)
    expect(nasal[0]).toMatchObject({ type: 'Band', bw: 1 })
    expect(nasal[0].gain).toBeGreaterThanOrEqual(-4)
    expect(nasal[0].gain).toBeLessThanOrEqual(-2)
    expect(nasal[0].freq).toBeGreaterThanOrEqual(900)
    expect(nasal[0].freq).toBeLessThanOrEqual(1600)
    expect(nasal[0].byEar).toBeUndefined()
    expect(eq.some((e) => e.why.key === 'engine.suggest.why.body')).toBe(false)
    // centred toward the larger excess: definition → the top of the range
    expect(eqOf(voiceAnalysis(5, 5), goal(['nasal'])).find((e) => e.why.key === 'suggestx.why.nasal')?.freq).toBe(1600)
  })

  it('not confirmed: a gentle -1.5 dB band marked by ear', () => {
    const eq = eqOf(fakeAnalysis(), goal(['nasal']))
    expect(eq).toEqual([{ type: 'Band', freq: 1000, gain: -BY_EAR_DB, bw: 1, why: { key: 'suggestx.why.byEar.nasal' }, byEar: true }])
  })

  it('by-ear bands are flagged in the sheet and the JSON; no flag without them', () => {
    const s = suggest(take(fakeAnalysis()), '8 cm', undefined, goal(['nasal']))
    if (!s) throw new Error('no suggestion')
    expect(suggestionToText(s)).toContain('Type Band (by ear) · Frequency 1000 Hz · Gain -1.5 dB')
    expect(suggestionToText(s)).toContain("we didn't measure this, but you hear it")
    expect(suggestionToJson(s).eq[0].byEar).toBe(true)
    const plain = suggest(take(voiceAnalysis(1, 5)), '8 cm')
    expect(plain && suggestionToJson(plain).eq.every((e) => !('byEar' in e))).toBe(true)
  })
})

describe('other perceived issues', () => {
  it('not confirmed: 1.5 dB in that direction, never more; confirmed: the measured correction only', () => {
    const one = (i: PerceivedIssue, a: Analysis = fakeAnalysis()) => eqOf(a, goal([i])).filter((e) => e.byEar)
    expect(one('boomy')).toMatchObject([{ type: 'Low Shelf', freq: 150, gain: -1.5 }])
    expect(one('thin')).toMatchObject([{ type: 'Low Shelf', freq: 150, gain: 1.5 }])
    expect(one('muffled')).toMatchObject([{ type: 'Band', freq: 450, gain: -1.5 }])
    expect(one('harsh')).toMatchObject([{ type: 'Band', freq: 3500, gain: -1.5 }])
    expect(one('sharpS')).toMatchObject([{ type: 'High Shelf', freq: 10000, gain: -1.5 }])
    expect(one('dull')).toMatchObject([{ type: 'High Shelf', freq: 10000, gain: 1.5 }])
    // confirmed boomy: the measured low-shelf cut, no by-ear band
    const boomy = voiceAnalysis(1, 5)
    expect(one('boomy', boomy)).toEqual([])
    expect(eqOf(boomy, goal(['boomy']))).toEqual(eqOf(boomy, DEFAULT_GOAL))
  })

  it('no by-ear boost where the room beats the voice', () => {
    const noisy = fakeAnalysis({ snr: 10, noise: -40, bandSnr: Array(9).fill(5) })
    expect(eqOf(noisy, goal(['thin'])).some((e) => e.byEar)).toBe(false)
    expect(eqOf(noisy, goal(['boomy'])).some((e) => e.byEar)).toBe(true)
  })
})
