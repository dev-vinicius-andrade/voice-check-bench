import { describe, expect, it } from 'vitest'
import { fakeAnalysis } from '../audio/testSignals'
import { suggest } from '../settings/suggest'
import type { AnalysisResult, StepKey, Take } from '../types'
import { anonymizedSummary } from './summary'

const mkTake = (id: number, session: string, step: StepKey | null, analysis: AnalysisResult = fakeAnalysis()): Take => ({
  id,
  name: `take ${id} (Secret Device)`,
  session,
  step,
  device: 'Secret Device',
  sampleRate: 48000,
  samples: new Float32Array(16),
  created: new Date(id).toISOString(),
  analysis,
})
const MIC = { model: 'Shure SM7B', kind: 'dynamic', pattern: 'cardioid', address: 'end' } as const

describe('anonymizedSummary', () => {
  it('keeps numbers and the mic, drops names, devices, dates, ids and audio', () => {
    const tone = fakeAnalysis({ tones: [{ hz: 780.2, db: 18.04 }], noiseKind: 'tonal', speechMed: -22.04 })
    const takes = [mkTake(1, 's1', 'c8', tone), mkTake(2, 's1', 'fx'), mkTake(3, 's2', 'c2')]
    const s = suggest(takes[0], '8 cm')
    const out = anonymizedSummary(takes, takes[1], MIC, s)
    expect(out).toMatchObject({ app: 'voice-check-bench', version: 1, mic: MIC })
    expect(out.takes.map((t) => t.step)).toEqual(['c8', 'fx'])
    expect(out.takes[0].analysis).toMatchObject({ speechMed: -22, noiseKind: 'tonal', tones: [{ hz: 780, db: 18 }] })
    expect(Object.keys(out.takes[0].analysis).sort()).toEqual(
      ['bandSnr', 'noise', 'noiseKind', 'rel', 'sibP95', 'snr', 'speechMed', 'spread', 'tones'].sort(),
    )
    expect(out.suggestion).not.toBeNull()
    expect(out.suggestion).not.toHaveProperty('basedOn')
    const json = JSON.stringify(out)
    expect(json).not.toMatch(/Secret Device|take \d|created|"id"|samples|1970/)
  })

  it('summarizes a free take alone and works without a suggestion', () => {
    const takes = [mkTake(1, 'free', null), mkTake(2, 'free', null)]
    const out = anonymizedSummary(takes, takes[1], MIC, null)
    expect(out.takes).toHaveLength(1)
    expect(out.suggestion).toBeNull()
  })
})

describe('anonymizedSummary JSON', () => {
  it('writes non-finite numbers as null', () => {
    const takes = [mkTake(1, 'free', null, fakeAnalysis({ snr: Number.NaN }))]
    const json = JSON.parse(JSON.stringify(anonymizedSummary(takes, takes[0], MIC, null)))
    expect(json.takes[0].analysis.snr).toBeNull()
  })
})

describe('anonymizedSummary goal', () => {
  it('shares the goal style (natural by default), never the perceived issues', () => {
    const takes = [mkTake(1, 's1', 'c8'), mkTake(2, 's1', 'fx')]
    expect(anonymizedSummary(takes, takes[1], MIC, null).goalStyle).toBe('natural')
    const s = suggest(takes[0], '8 cm', undefined, { style: 'warm', perceived: ['nasal', 'dull'] })
    expect(s?.eq.some((e) => e.byEar)).toBe(true)
    const out = anonymizedSummary(takes, takes[1], MIC, s, { style: 'warm', perceived: ['nasal', 'dull'] })
    expect(out.goalStyle).toBe('warm')
    expect(JSON.stringify(out)).not.toMatch(/perceived|byEar|by ear|nasal|dull/i)
    // the shared EQ is the style-only suggestion
    const styleOnly = suggest(takes[0], '8 cm', undefined, { style: 'warm', perceived: [] })
    expect(out.suggestion?.eq).toEqual(styleOnly?.eq.map((e) => ({ ...e, why: expect.any(String) })))
  })
})
