import { describe, expect, it } from 'vitest'
import { fakeAnalysis } from '../../audio/testSignals'
import type { Analysis, AnalysisResult, StepKey, Take } from '../../types'
import { beforeAfterPair, hasBandSnr, voiceBandSnr } from './roomNoise'

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
