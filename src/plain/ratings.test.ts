import { describe, expect, it } from 'vitest'
import { fakeAnalysis } from '../audio/testSignals'
import type { Analysis } from '../types'
import { noiseRating, plainRatings, voiceRating, voiceState, volumeRating } from './ratings'
import { processedPair, voiceAnalysis } from './testFixtures'

describe('noise rating', () => {
  it('maps SNR to quiet / noticeable / loud', () => {
    const r = (snr: number) => noiseRating(fakeAnalysis({ snr, noiseKind: snr >= 30 ? 'quiet' : 'broadband' }))
    expect([r(30), r(29.9), r(20), r(19.9)].map((x) => [x.status, x.label.key])).toEqual([
      ['good', 'plain.rating.noise.label.quiet'],
      ['warn', 'plain.rating.noise.label.noticeable'],
      ['warn', 'plain.rating.noise.label.noticeable'],
      ['bad', 'plain.rating.noise.label.loud'],
    ])
  })

  it('explains by noise kind', () => {
    const k = (over: Partial<Analysis>) => noiseRating(fakeAnalysis(over)).explain.key
    expect(k({ snr: 15, noiseKind: 'tonal' })).toBe('plain.rating.noise.explain.tonal')
    expect(k({ snr: 15, noiseKind: 'hum' })).toBe('plain.rating.noise.explain.hum')
    expect(k({ snr: 15, noiseKind: 'broadband' })).toBe('plain.rating.noise.explain.broadband')
    expect(k({ snr: 45, noiseKind: 'quiet' })).toBe('plain.rating.noise.explain.quiet')
  })

  it('falls back to SNR when the noise diagnosis is missing or says quiet on a noisy take', () => {
    const missing = { noiseKind: null as unknown as Analysis['noiseKind'], noiseBands: [], bandSnr: [], tones: [] }
    expect(noiseRating(fakeAnalysis({ ...missing, snr: 18 })).explain.key).toBe('plain.rating.noise.explain.broadband')
    expect(noiseRating(fakeAnalysis({ ...missing, snr: 35 })).explain.key).toBe('plain.rating.noise.explain.quiet')
    expect(noiseRating(fakeAnalysis({ noiseKind: 'quiet', noise: -65, snr: 22 })).explain.key).toBe('plain.rating.noise.explain.broadband')
  })
})

describe('volume rating', () => {
  const v = (over: Partial<Analysis>) => {
    const r = volumeRating(fakeAnalysis(over))
    return [r.status, r.label.key.split('.').pop(), r.explain.key.split('.').pop()]
  }
  it('follows the level and peaks checks', () => {
    expect(v({})).toEqual(['good', 'good', 'good'])
    expect(v({ speechMed: -30 })).toEqual(['warn', 'tooQuiet', 'tooQuiet'])
    expect(v({ speechMed: -33 })).toEqual(['bad', 'tooQuiet', 'tooQuiet'])
    expect(v({ speechMed: -14 })).toEqual(['warn', 'tooLoud', 'tooLoud'])
    expect(v({ speechMed: -10 })).toEqual(['bad', 'tooLoud', 'tooLoud'])
    expect(v({ peak: -0.5 })).toEqual(['warn', 'tooLoud', 'tooLoud'])
    expect(v({ clip: 3, speechMed: -30 })).toEqual(['bad', 'distorting', 'distorting'])
  })
})

describe('voice rating', () => {
  const label = (a: Analysis) => voiceRating(a).label.key.replace('plain.rating.voice.label.', '')

  it('is natural within 3 dB', () => {
    expect(label(fakeAnalysis())).toBe('natural')
    expect(label(voiceAnalysis(3, 3))).toBe('natural')
    expect(voiceRating(fakeAnalysis()).status).toBe('good')
    expect(voiceRating(fakeAnalysis()).explain.key).toBe('plain.rating.voice.explain.natural')
  })

  it('reaches every label by band and sign', () => {
    expect(label(voiceAnalysis(1, 5))).toBe('mild.boomy')
    expect(label(voiceAnalysis(2, 5))).toBe('mild.boomy')
    expect(label(voiceAnalysis(3, 5))).toBe('mild.boxy')
    expect(label(voiceAnalysis(4, -5))).toBe('mild.hollow')
    expect(label(voiceAnalysis(5, -5))).toBe('mild.muffled')
    expect(label(voiceAnalysis(6, -5))).toBe('mild.muffled')
    expect(label(voiceAnalysis(6, 5))).toBe('mild.harsh')
    expect(label(voiceAnalysis(7, 5))).toBe('mild.sharpS')
    expect(label(voiceAnalysis(7, -5))).toBe('mild.dull')
    expect(label(voiceAnalysis(8, -5))).toBe('mild.dull')
    expect(label(voiceAnalysis(1, -5))).toBe('mild.thin')
    expect(label(voiceAnalysis(2, -5))).toBe('mild.thin')
  })

  it('maps the bands the SPEC leaves open to the nearest everyday word', () => {
    expect(label(voiceAnalysis(3, -5))).toBe('mild.hollow')
    expect(label(voiceAnalysis(4, 5))).toBe('mild.boxy')
    expect(label(voiceAnalysis(5, 5))).toBe('mild.harsh')
    expect(label(voiceAnalysis(8, 5))).toBe('mild.harsh')
  })

  it('says "a bit" for 3–6 dB and "very" above 6 dB', () => {
    expect(label(voiceAnalysis(1, 6))).toBe('mild.boomy')
    expect(voiceRating(voiceAnalysis(1, 6)).status).toBe('warn')
    expect(label(voiceAnalysis(1, 6.5))).toBe('strong.boomy')
    expect(voiceRating(voiceAnalysis(1, 6.5)).status).toBe('bad')
  })

  it('flags harsh S peaks as sharp S sounds when the balance is otherwise natural', () => {
    const r = voiceRating(fakeAnalysis({ sibP95: -3 }))
    expect(r.label.key).toBe('plain.rating.voice.label.mild.sharpS')
    expect(r.explain.key).toBe('plain.rating.voice.explain.sharpS')
    expect(r.status).toBe('warn')
  })

  it('the largest deviation wins', () => {
    const a = fakeAnalysis({ rel: [-18, -4 + 6, -1, 2, 0, -6, -7 - 10, -11, -17] })
    expect(voiceState(a).label).toBe('muffled')
  })
})

describe('plainRatings', () => {
  it('returns noise, volume and voice in that order', () => {
    expect(plainRatings(fakeAnalysis()).map((r) => r.id)).toEqual(['noise', 'volume', 'voice'])
  })
})

describe('over-processing (v0.8)', () => {
  it('says "Cut to silence" instead of "Quiet" when the pauses are digital silence', () => {
    const bad = noiseRating(fakeAnalysis({ snr: 57, noise: -100, zeroRatio: 0.4, gateSwitches: 23 }))
    expect(bad).toEqual({
      id: 'noise',
      status: 'bad',
      label: { key: 'plain.rating.noise.label.cutToSilence' },
      explain: { key: 'plain.rating.noise.explain.cutToSilence' },
    })
    expect(noiseRating(fakeAnalysis({ gateSwitches: 8 })).status).toBe('warn')
    expect(noiseRating(fakeAnalysis({ gateSwitches: 8 })).label.key).toBe('plain.rating.noise.label.cutToSilence')
    // a light trace of digital silence is not over-processing
    expect(noiseRating(fakeAnalysis({ zeroRatio: 0.01, gateSwitches: 2 })).label.key).toBe('plain.rating.noise.label.quiet')
    // a loud room stays "Loud"
    expect(noiseRating(fakeAnalysis({ snr: 12, noiseKind: 'broadband', gateSwitches: 8 })).label.key).toBe('plain.rating.noise.label.loud')
  })

  it('the voice rating reports thin or harsh from the regressions against the raw take', () => {
    expect(voiceRating(fakeAnalysis(), ['thin'])).toMatchObject({ status: 'bad', label: { key: 'plain.rating.voice.label.strong.thin' } })
    expect(voiceRating(fakeAnalysis(), ['quieter', 'harsh'])).toMatchObject({ status: 'bad', label: { key: 'plain.rating.voice.label.strong.harsh' } })
    expect(voiceRating(fakeAnalysis(), ['quieter', 'chopped']).label.key).toBe('plain.rating.voice.label.natural')
    const { raw, fx } = processedPair({ rel: fakeAnalysis().rel })
    expect(plainRatings(fx, { raw })[2].label.key).toBe('plain.rating.voice.label.natural')
    const pair = processedPair()
    expect(plainRatings(pair.fx, { raw: pair.raw }).map((r) => r.label.key)).toEqual([
      'plain.rating.noise.label.cutToSilence',
      'plain.rating.volume.label.tooQuiet',
      'plain.rating.voice.label.strong.thin',
    ])
  })
})
