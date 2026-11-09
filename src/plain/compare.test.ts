import { describe, expect, it } from 'vitest'
import { BANDS } from '../audio/reference'
import { fakeAnalysis } from '../audio/testSignals'
import { compareProcessed } from './compare'
import { processedPair, relWithDev } from './testFixtures'

describe('compareProcessed', () => {
  it('flags every regression of an over-processed take, in order', () => {
    const { raw, fx } = processedPair()
    expect(compareProcessed(raw, fx)).toEqual({ regressions: ['quieter', 'thin', 'harsh', 'chopped'], levelDrop: 18 })
  })

  it('finds nothing when the processed take is as good as the raw one', () => {
    const a = fakeAnalysis()
    expect(compareProcessed(a, a)).toEqual({ regressions: [], levelDrop: 0 })
    // louder after the effects: negative drop, not "quieter"
    expect(compareProcessed(a, fakeAnalysis({ speechMed: -18 }))).toEqual({ regressions: [], levelDrop: -4 })
  })

  it('quieter only above an 8 dB level drop', () => {
    const raw = fakeAnalysis({ speechMed: -20 })
    expect(compareProcessed(raw, fakeAnalysis({ speechMed: -28 })).regressions).toEqual([])
    expect(compareProcessed(raw, fakeAnalysis({ speechMed: -28.1 })).regressions).toEqual(['quieter'])
  })

  it('thin when the mean boom + warmth deviation drops more than 12 dB', () => {
    const raw = fakeAnalysis()
    const bass = (d: number) => {
      const rel = BANDS.map((b) => b.ref)
      rel[1] -= d
      rel[2] -= d
      return fakeAnalysis({ rel })
    }
    // lowering boom and warmth by d lowers their deviations by 5d/7 (level matching moves the mean by -2d/7)
    expect(compareProcessed(raw, bass(16.7)).regressions).toEqual([])
    expect(compareProcessed(raw, bass(17)).regressions).toEqual(['thin'])
  })

  it('harsh when presence or sibilance rises more than 6 dB', () => {
    const raw = fakeAnalysis()
    expect(compareProcessed(raw, fakeAnalysis({ rel: relWithDev(6, 5.9) })).regressions).toEqual([])
    expect(compareProcessed(raw, fakeAnalysis({ rel: relWithDev(6, 6.5) })).regressions).toEqual(['harsh'])
    expect(compareProcessed(raw, fakeAnalysis({ rel: relWithDev(7, 7) })).regressions).toEqual(['harsh'])
  })

  it('chopped only when the processed take is more over-processed than the raw one', () => {
    const raw = fakeAnalysis()
    expect(compareProcessed(raw, fakeAnalysis({ gateSwitches: 8 })).regressions).toEqual(['chopped'])
    expect(compareProcessed(raw, fakeAnalysis({ zeroRatio: 0.05 })).regressions).toEqual([])
    const gatedRaw = fakeAnalysis({ zeroRatio: 0.2 })
    expect(compareProcessed(gatedRaw, fakeAnalysis({ zeroRatio: 0.4 })).regressions).toEqual([])
  })

  it('ignores missing band data', () => {
    const raw = fakeAnalysis({ rel: Array(9).fill(NaN) })
    expect(compareProcessed(raw, fakeAnalysis())).toEqual({ regressions: [], levelDrop: 0 })
  })
})
