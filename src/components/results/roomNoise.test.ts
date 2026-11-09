import { describe, expect, it } from 'vitest'
import { fakeAnalysis } from '../../audio/testSignals'
import { suggest } from '../../settings/suggest'
import type { Analysis, AnalysisResult, StepKey, Take } from '../../types'
import { anonymizedSummary, beforeAfterPair, fmtHz, hasBandSnr, voiceBandSnr } from './roomNoise'

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

describe('band SNR helpers', () => {
  it('needs finite noise bands and band SNR', () => {
    expect(hasBandSnr(fakeAnalysis())).toBe(true)
    expect(hasBandSnr(fakeAnalysis({ bandSnr: [], noiseBands: [] }))).toBe(false)
    expect(hasBandSnr(fakeAnalysis({ noiseBands: Array(9).fill(Number.NaN) }))).toBe(false)
    const old = { ...fakeAnalysis() } as Partial<Analysis>
    delete old.bandSnr
    expect(hasBandSnr(old as Analysis)).toBe(false)
  })

  it('averages the 640 Hz–5 kHz bands', () => {
    expect(voiceBandSnr(fakeAnalysis({ bandSnr: [0, 0, 0, 0, 10, 20, 30, 0, 0] }))).toBe(20)
    expect(voiceBandSnr(fakeAnalysis({ bandSnr: [] }))).toBeNaN()
  })

  it('formats frequencies', () => {
    expect(fmtHz(780.4)).toBe('780 Hz')
    expect(fmtHz(2400)).toBe('2400 Hz')
    expect(fmtHz(1559)).not.toBe(fmtHz(1617))
    expect(fmtHz(12500)).toBe('12.5 kHz')
  })
})

describe('beforeAfterPair', () => {
  const takes = [mkTake(1, 's1', 'c2'), mkTake(2, 's1', 'c8'), mkTake(3, 's1', 'fx', fakeAnalysis({ snr: 40 }))]

  it('pairs the processed take with the raw control at the processed distance', () => {
    const p = beforeAfterPair(takes, takes[2], 's1', '8 cm')
    expect([p?.raw.id, p?.fx.id]).toEqual([2, 3])
  })

  it('ignores fxDist of another session and needs a processed take', () => {
    expect(beforeAfterPair(takes, takes[0], 's9', '8 cm')?.fx.id).toBe(3)
    expect(beforeAfterPair(takes.slice(0, 2), takes[0], 's1', null)).toBeNull()
    expect(beforeAfterPair([...takes, mkTake(4, 'free', null)], mkTake(4, 'free', null), 's1', null)).toBeNull()
  })
})

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
