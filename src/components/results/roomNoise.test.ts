import { describe, expect, it } from 'vitest'
import { fakeAnalysis } from '../../audio/testSignals'
import type { Analysis, AnalysisResult, StepKey, Take } from '../../types'
import { beforeAfterPair, hasBandSnr, rawReference, voiceBandSnr } from './roomNoise'

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

describe('rawReference', () => {
  it('is the raw control at the processed distance, else the best control, never an unanalyzable take', () => {
    const takes = [mkTake(1, 's1', 'c2'), mkTake(2, 's1', 'c8'), mkTake(3, 's1', 'fx')]
    expect(rawReference(takes, takes[2], 's1', '8 cm')?.id).toBe(2)
    expect(rawReference(takes, takes[2], 's1', '2 cm')?.id).toBe(1)
    // 8 cm not analyzable: falls back to the best control (c2 has the reference voice, c15 a boomy one)
    const broken = [mkTake(1, 's1', 'c2'), mkTake(2, 's1', 'c8', { error: 'x' }), mkTake(5, 's1', 'c15', fakeAnalysis({ rel: [-18, 8, 8, 2, 0, -6, -7, -11, -17] })), mkTake(3, 's1', 'fx')]
    expect(rawReference(broken, broken[3], 's1', '8 cm')?.id).toBe(1)
    expect(rawReference(takes, mkTake(4, 'free', 'fx'), 's1', null)).toBeNull()
    // the before/after card pairs with the same take
    expect(beforeAfterPair(takes, takes[2], 's1', '2 cm')?.raw.id).toBe(1)
  })
})
