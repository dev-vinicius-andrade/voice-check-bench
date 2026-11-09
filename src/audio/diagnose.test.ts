// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { Analysis, CheckId } from '../types'
import { analyze } from './analyze'
import { englishText } from '../settings/english'
import type { Check } from '../types'
import { countByStatus, diagnose, f1, topIssues } from './diagnose'
import { fakeAnalysis, syntheticTake } from './testSignals'

/** A check with its messages rendered in English (as the en locale shows them). */
const toEn = (c: Check) => ({
  id: c.id,
  status: c.status,
  title: englishText(c.titleMsg),
  value: c.valueMsg ? englishText(c.valueMsg) : '',
  detail: englishText(c.detailMsg),
  fix: c.fixMsg ? englishText(c.fixMsg) : '',
})
const diagEn = (a: Analysis) => diagnose(a).map(toEn)

const ALL_IDS: CheckId[] = [
  'level', 'peaks', 'noise', 'overprocessed', 'silence', 'hum', 'tones', 'bandsnr',
  'rumble', 'boom', 'warmth', 'mud', 'body', 'definition', 'presence', 'sibilance', 'air',
  'harsh', 'consistency',
]

describe('diagnose', () => {
  it('gives unique ids and valid statuses on a synthetic take, in the prototype order', () => {
    const checks = diagEn(analyze(syntheticTake(), 48000) as Analysis)
    const ids = checks.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(ALL_IDS.filter((id) => ids.includes(id)))
    for (const c of checks) {
      expect(['good', 'warn', 'bad']).toContain(c.status)
      expect(c.title).not.toBe('')
      expect(c.value).not.toBe('')
      expect(c.detail).not.toBe('')
      expect(c.fix === '').toBe(c.status === 'good')
    }
  })

  it('emits all 19 checks in order when every optional check applies', () => {
    const a = fakeAnalysis({ quietBroken: true, hum: [{ hz: 50, db: 3 }, { hz: 60, db: 8 }], sibP95: -4, zeroRatio: 0.01 })
    const checks = diagEn(a)
    expect(checks.map((c) => c.id)).toEqual(ALL_IDS)
  })

  it('a reference-shaped take passes the tone checks', () => {
    const checks = diagEn(fakeAnalysis())
    expect(checks.map((c) => c.id)).not.toContain('silence')
    expect(checks.map((c) => c.id)).not.toContain('hum')
    expect(checks.map((c) => c.id)).not.toContain('harsh')
    expect(checks.every((c) => c.status === 'good')).toBe(true)
    expect(checks.find((c) => c.id === 'boom')).toEqual({
      id: 'boom', status: 'good', title: 'Boom (80–160 Hz)', value: '0.0 dB vs reference', detail: 'Bass is in a healthy range.', fix: '',
    })
  })

  it('ports thresholds and texts from the prototype', () => {
    const a = fakeAnalysis({ speechMed: -30, clip: 3, peak: 0, noise: -60, snr: 30, noiseFromQuiet: false, hum: [{ hz: 60, db: 14 }], spread: 13 })
    const by = Object.fromEntries(diagEn(a).map((c) => [c.id, c]))
    expect(by.level).toMatchObject({ status: 'warn', value: '-30.0 dBFS median', detail: 'Voice is quiet; listeners will turn you up, raising noise too.' })
    expect(by.peaks).toMatchObject({ status: 'bad', value: 'peak 0.0 dBFS · 3 clipped samples' })
    expect(by.noise).toMatchObject({ status: 'warn', value: '-60.0 dBFS in silence · SNR 30 dB', detail: 'No clean 3 s silence found; estimate is rough. Hiss, fans or room noise are audible in pauses.' })
    expect(by.hum).toMatchObject({ status: 'bad', value: 'strongest 60 Hz, +14.0 dB over neighbours', detail: 'A steady 60 Hz buzz from the power line sits under your voice.' })
    expect(by.consistency).toMatchObject({ status: 'bad', value: '13.0 dB spread between seconds' })
    // gated noise floor downgrades bad hum to warn
    const gated = diagEn(fakeAnalysis({ noise: -80, hum: [{ hz: 50, db: 20 }] })).find((c) => c.id === 'hum')
    expect(gated?.status).toBe('warn')
  })

  it('grades band deviations: |v| <= 3 good, <= 6 warn, else bad; rumble one-sided', () => {
    // level-matching offset is the mean over bands 1..7, so shift only band 8 (air) and band 0 (rumble)
    const rel = [-18 + 9, -4, -1, 2, 0, -6, -7, -11, -17 - 5]
    const by = Object.fromEntries(diagEn(fakeAnalysis({ rel })).map((c) => [c.id, c]))
    expect(by.air).toMatchObject({ status: 'warn', value: '-5.0 dB vs reference', detail: 'Very little top end. Common for budget dynamic mics.' })
    expect(by.rumble).toMatchObject({ status: 'bad', value: '+9.0 dB vs reference' })
    const low = Object.fromEntries(diagEn(fakeAnalysis({ rel: [-40, -4, -1, 2, 0, -6, -7, -11, -17] })).map((c) => [c.id, c]))
    expect(low.rumble.status).toBe('good')
  })
})

describe('noisy-room checks', () => {
  const by = (a: Analysis) => Object.fromEntries(diagEn(a).map((c) => [c.id, c]))
  // bandSnr 4..6 average = target
  const withVoiceSnr = (target: number) => {
    const speechBands = [-40, -40, -40, -40, -40, -40, -40, -40, -40]
    return fakeAnalysis({ speechBands, noiseBands: speechBands.map((v) => v - target), bandSnr: speechBands.map(() => target) })
  }

  it('passes in a quiet room', () => {
    const b = by(fakeAnalysis())
    expect(b.tones).toMatchObject({ status: 'good', title: 'Fan / machine tones', value: 'no steady tones', fix: '' })
    expect(b.bandsnr).toMatchObject({ status: 'good', title: 'Voice vs room (per band)', fix: '' })
  })

  it('warns on tones >= 12 dB and lists them', () => {
    const b = by(fakeAnalysis({ tones: [{ hz: 770, db: 18.2 }, { hz: 1560, db: 15.4 }, { hz: 200, db: 9 }, { hz: 3800, db: 8.5 }] }))
    expect(b.tones).toMatchObject({
      status: 'warn',
      value: '770 Hz +18 dB, 1560 Hz +15 dB, 200 Hz +9 dB',
      fix: 'Turn the mic so its least sensitive side faces the machine; the suggested settings add narrow EQ notches at these tones.',
    })
    expect(by(fakeAnalysis({ tones: [{ hz: 770, db: 11.9 }] })).tones.status).toBe('good')
  })

  it('grades voice-band SNR (640 Hz–5 kHz): < 15 bad, < 25 warn', () => {
    expect(by(withVoiceSnr(14)).bandsnr).toMatchObject({
      status: 'bad',
      value: 'voice bands 14 dB over the room',
      fix: 'Speak closer and keep the noise off-axis, then use the noise-reduction step in the suggested settings.',
    })
    expect(by(withVoiceSnr(15)).bandsnr.status).toBe('warn')
    expect(by(withVoiceSnr(24.9)).bandsnr.status).toBe('warn')
    expect(by(withVoiceSnr(25)).bandsnr.status).toBe('good')
    // only bands 4..6 count
    const a = withVoiceSnr(30)
    a.bandSnr = [0, 0, 0, 0, 30, 30, 30, 0, 0]
    expect(by(a).bandsnr.status).toBe('good')
  })

  it('skips both without a silence window (NaN noise bands)', () => {
    const ids = diagEn(fakeAnalysis({ noiseBands: Array(9).fill(NaN), tones: [] })).map((c) => c.id)
    expect(ids).not.toContain('tones')
    expect(ids).not.toContain('bandsnr')
  })
})

describe('over-processing check', () => {
  const over = (zeroRatio: number, gateSwitches: number) => diagEn(fakeAnalysis({ zeroRatio, gateSwitches })).find((c) => c.id === 'overprocessed')

  it('is skipped when there is no digital silence and no gate flipping', () => {
    expect(over(0, 0)).toBeUndefined()
  })

  it('grades zeroRatio > 0.15 / gateSwitches > 12 bad, > 0.05 / > 6 warn', () => {
    expect(over(0.01, 2)).toMatchObject({ status: 'good', title: 'Over-processing', value: '1 % digital silence · 2 cuts per 10 s', fix: '' })
    expect(over(0.05, 6)?.status).toBe('good')
    expect(over(0.051, 0)?.status).toBe('warn')
    expect(over(0, 6.1)?.status).toBe('warn')
    expect(over(0.15, 12)?.status).toBe('warn')
    expect(over(0.151, 0)?.status).toBe('bad')
    expect(over(0.4, 23.5)).toMatchObject({
      status: 'bad',
      value: '40 % digital silence · 24 cuts per 10 s',
      fix: 'Noise removal or the gate is too strong and is cutting your voice — reduce it.',
    })
  })

  it('sits right after the noise check', () => {
    const ids = diagEn(fakeAnalysis({ zeroRatio: 0.3, quietBroken: true })).map((c) => c.id)
    expect(ids.slice(2, 5)).toEqual(['noise', 'overprocessed', 'silence'])
  })
})

describe('generic copy', () => {
  it('names no mic model in any check text', () => {
    const worst = fakeAnalysis({
      speechMed: -40, clip: 5, noise: -40, snr: 10, quietBroken: true, hum: [{ hz: 60, db: 20 }], sibP95: -2, spread: 20,
      tones: [{ hz: 780, db: 20 }], bandSnr: Array(9).fill(5),
    })
    const texts = [-12, 12].flatMap((d) => diagEn({ ...worst, rel: worst.rel.map((v, i) => (i % 2 ? v + d : v - d)) }))
      .flatMap((c) => [c.title, c.value, c.detail, c.fix])
    expect(texts.join(' ')).not.toMatch(/K688|K669|SM7B|SM58|Fifine|Shure|Rode|Yeti/)
  })
})

describe('verdict helpers', () => {
  const a = fakeAnalysis({ quietBroken: true, clip: 2, speechMed: -30, spread: 10, sibP95: -3 })
  const checks = diagnose(a)

  it('countByStatus', () => {
    expect(countByStatus(checks)).toEqual({
      bad: checks.filter((c) => c.status === 'bad').length,
      warn: checks.filter((c) => c.status === 'warn').length,
    })
    expect(countByStatus(checks).bad).toBe(1)
  })

  it('topIssues lists bad first, then warn, without the silence window', () => {
    expect(topIssues(checks).map((c) => c.id)).toEqual(['peaks', 'level', 'harsh'])
    expect(topIssues(checks, 10).map((c) => c.id)).toEqual(['peaks', 'level', 'harsh', 'consistency'])
    expect(topIssues(diagnose(fakeAnalysis()))).toEqual([])
  })

  it('f1 formats signed one-decimal numbers', () => {
    expect(f1(1.25)).toBe('+1.3')
    expect(f1(-2)).toBe('-2.0')
    expect(f1(0)).toBe('0.0')
  })
})
