import { describe, expect, it } from 'vitest'
import { fakeAnalysis } from '../audio/testSignals'
import { clarityScore, mainIssue, penalties, scoreBand } from './score'
import { noisyAnalysis, voiceAnalysis } from './testFixtures'

describe('clarityScore', () => {
  it('scores a clean take at 100 with the clear headline', () => {
    const s = clarityScore(fakeAnalysis())
    expect(s.score).toBe(100)
    expect(s.main).toBe('none')
    expect(s.headline).toEqual({ key: 'plain.score.clear' })
    expect(s.explain).toEqual({ key: 'plain.score.explain.clear' })
    expect(s.penalties).toEqual({ noise: 0, level: 0, tone: 0, consistency: 0 })
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
    expect(mainIssue({ noise: 7.9, level: 7.9, tone: 7.9, consistency: 10 })).toBe('none')
    expect(mainIssue({ noise: 8, level: 8, tone: 8, consistency: 0 })).toBe('noise')
    expect(mainIssue({ noise: 8, level: 12, tone: 12, consistency: 0 })).toBe('level')
    expect(mainIssue({ noise: 0, level: 0, tone: 9, consistency: 0 })).toBe('tone')
  })

  it('maps scores to bands at 85 / 70 / 50', () => {
    expect([100, 85, 84, 70, 69, 50, 49, 0].map(scoreBand)).toEqual(['clear', 'clear', 'good', 'good', 'ok', 'ok', 'hard', 'hard'])
  })
})
