import { describe, expect, it } from 'vitest'
import { fakeAnalysis } from '../audio/testSignals'
import { clarityScore, mainIssue, overprocessingPenalty, penalties, scoreBand } from './score'
import { noisyAnalysis, processedPair, voiceAnalysis } from './testFixtures'

describe('clarityScore', () => {
  it('scores a clean take at 100 with the clear headline', () => {
    const s = clarityScore(fakeAnalysis())
    expect(s.score).toBe(100)
    expect(s.main).toBe('none')
    expect(s.headline).toEqual({ key: 'plain.score.clear' })
    expect(s.explain).toEqual({ key: 'plain.score.explain.clear' })
    expect(s.penalties).toEqual({ noise: 0, level: 0, tone: 0, consistency: 0, overprocessed: 0 })
  })

  it('scores a very noisy take below 50 with noise as the main issue', () => {
    const s = clarityScore(noisyAnalysis({ snr: 0, spread: 12 }))
    // noise 45 (cap) + 5 (strong tone) · consistency 1.5 × 4 = 6
    expect(s.penalties.noise).toBe(50)
    expect(s.penalties.consistency).toBe(6)
    expect(s.score).toBe(44)
    expect(s.main).toBe('noise')
    expect(s.headline.key).toBe('plain.score.hard.noise')
    expect(s.explain.key).toBe('plain.score.explain.hard.noise')
  })

  it('applies the noise formula and the +5 for tones or hum ≥ 12 dB', () => {
    expect(penalties(fakeAnalysis({ snr: 20 })).noise).toBe(15)
    expect(penalties(fakeAnalysis({ snr: 30 })).noise).toBe(0)
    expect(penalties(fakeAnalysis({ snr: 58, tones: [{ hz: 900, db: 12 }] })).noise).toBe(5)
    expect(penalties(fakeAnalysis({ snr: 58, tones: [{ hz: 900, db: 11.9 }] })).noise).toBe(0)
    expect(penalties(fakeAnalysis({ snr: 58, hum: [{ hz: 50, db: 14 }] })).noise).toBe(5)
  })

  it('penalizes level by distance from [-26, -16] (max 15) and clipping by 15', () => {
    expect(penalties(fakeAnalysis({ speechMed: -30 })).level).toBe(8)
    expect(penalties(fakeAnalysis({ speechMed: -13 })).level).toBe(6)
    expect(penalties(fakeAnalysis({ speechMed: -45 })).level).toBe(15)
    expect(penalties(fakeAnalysis({ speechMed: -16 })).level).toBe(0)
    const clipped = clarityScore(fakeAnalysis({ clip: 40 }))
    expect(clipped.penalties.level).toBe(15)
    expect(clipped.score).toBe(85)
    expect(clipped.main).toBe('level')
    expect(penalties(fakeAnalysis({ clip: 1, speechMed: -10 })).level).toBe(27)
  })

  it('sums tone excess over 3 dB on bands 1..7 and caps it at 25', () => {
    // band 2 at +5 dB: the other bands read -5/6, under 3 dB
    expect(penalties(voiceAnalysis(2, 5)).tone).toBeCloseTo(2.4, 6)
    // band 8 (air) does not count
    expect(penalties(voiceAnalysis(8, 12)).tone).toBe(0)
    const huge = fakeAnalysis({ rel: [-18, 20, 20, -20, 0, -30, 10, -40, -17] })
    expect(penalties(huge).tone).toBe(25)
  })

  it('penalizes spread above 8 dB, capped at 10', () => {
    expect(penalties(fakeAnalysis({ spread: 8 })).consistency).toBe(0)
    expect(penalties(fakeAnalysis({ spread: 10 })).consistency).toBe(3)
    expect(penalties(fakeAnalysis({ spread: 30 })).consistency).toBe(10)
  })

  it('picks ok.<main> between 50 and 69', () => {
    const s = clarityScore(fakeAnalysis({ rel: [-18, 20, 20, -20, 0, -30, 10, -40, -17], spread: 14 }))
    expect(s.score).toBe(66)
    expect(s.main).toBe('tone')
    expect(s.headline.key).toBe('plain.score.ok.tone')
  })

  it('clamps the score to 0', () => {
    const s = clarityScore(noisyAnalysis({ snr: -10, clip: 5, speechMed: -50, spread: 40, rel: [-18, 20, 20, -20, 0, -30, 10, -40, -17] }))
    expect(s.score).toBe(0)
  })
})

describe('mainIssue and scoreBand', () => {
  it('needs at least 8 points and keeps noise > level > tone on ties', () => {
    expect(mainIssue({ noise: 7.9, level: 7.9, tone: 7.9, consistency: 10, overprocessed: 0 })).toBe('none')
    expect(mainIssue({ noise: 8, level: 8, tone: 8, consistency: 0, overprocessed: 0 })).toBe('noise')
    expect(mainIssue({ noise: 8, level: 12, tone: 12, consistency: 0, overprocessed: 0 })).toBe('level')
    expect(mainIssue({ noise: 0, level: 0, tone: 9, consistency: 0, overprocessed: 0 })).toBe('tone')
    expect(mainIssue({ noise: 12, level: 0, tone: 12, consistency: 0, overprocessed: 12 })).toBe('overprocessed')
    expect(mainIssue({ noise: 13, level: 0, tone: 0, consistency: 0, overprocessed: 12 })).toBe('noise')
  })

  it('maps scores to bands at 85 / 70 / 50', () => {
    expect([100, 85, 84, 70, 69, 50, 49, 0].map(scoreBand)).toEqual(['clear', 'clear', 'good', 'good', 'ok', 'ok', 'hard', 'hard'])
  })
})

describe('over-processing (v0.8)', () => {
  it('caps SNR at 45 for the noise part, so a digital-silence floor scores like any quiet room', () => {
    expect(penalties(fakeAnalysis({ snr: 197 })).noise).toBe(0)
    expect(penalties(fakeAnalysis({ snr: 45 })).noise).toBe(0)
    expect(penalties(fakeAnalysis({ snr: 20 })).noise).toBe(15)
  })

  it('penalises digital silence and gate flips up to 35 points', () => {
    const p = (zeroRatio: number, gateSwitches: number) => overprocessingPenalty(fakeAnalysis({ zeroRatio, gateSwitches }))
    expect(p(0, 0)).toBe(0)
    expect(p(0.05, 6)).toBe(0)
    expect(p(0.15, 0)).toBeCloseTo(14, 6)
    expect(p(0, 12)).toBeCloseTo(17.5, 6)
    expect(p(0.3, 0)).toBeCloseTo(35, 6)
    expect(p(0.9, 50)).toBe(35)
    expect(penalties(fakeAnalysis({ gateSwitches: 12 })).overprocessed).toBeCloseTo(17.5, 6)
  })

  it('adds 10 points per regression against the raw take', () => {
    const { raw, fx } = processedPair({ zeroRatio: 0, gateSwitches: 0 })
    // quieter, thin, harsh (not chopped without digital silence)
    expect(penalties(fx).overprocessed).toBe(0)
    expect(penalties(fx, { raw }).overprocessed).toBe(30)
    expect(penalties(fx, { raw: null }).overprocessed).toBe(0)
  })

  it('a processed take that broke the voice scores below its raw take, with the over-processing headline', () => {
    const { raw, fx } = processedPair()
    const before = clarityScore(raw)
    const after = clarityScore(fx, { raw })
    expect(after.penalties.overprocessed).toBe(75)
    expect(after.score).toBeLessThan(before.score)
    expect(after.main).toBe('overprocessed')
    expect(after.headline).toEqual({ key: 'plain.score.overprocessed' })
    expect(after.explain).toEqual({ key: 'plain.score.explain.overprocessed' })
    // without the raw take the digital silence alone still dominates
    expect(clarityScore(fx).headline.key).toBe('plain.score.overprocessed')
  })

  it('keeps the usual headline when over-processing is not the biggest problem', () => {
    const s = clarityScore(noisyAnalysis({ snr: 0, gateSwitches: 9 }))
    expect(s.penalties.overprocessed).toBeCloseTo(8.75, 6)
    expect(s.main).toBe('noise')
    expect(s.headline.key).toBe('plain.score.hard.noise')
  })
})
