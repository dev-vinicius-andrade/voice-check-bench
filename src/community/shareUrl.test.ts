import { describe, expect, it } from 'vitest'
import { MAX_SHARE_URL, buildShareUrl } from './shareUrl'
import type { CommunitySummary } from './types'

type Analysis = CommunitySummary['takes'][number]['analysis']

const analysis = (tones: number, rel: number): Analysis => ({
  speechMed: -22.4,
  noise: -61.3,
  snr: 38.9,
  rel: Array.from({ length: rel }, (_, i) => -i - 0.123),
  bandSnr: [10.1, 20.2, 30.3],
  tones: Array.from({ length: tones }, (_, i) => ({ hz: 100 + i, db: 12.34 })),
  noiseKind: 'tonal',
  spread: 9.87,
  sibP95: -30.5,
})

const summary = (takes: number, tones = 1, rel = 9): CommunitySummary => ({
  app: 'voice-check-bench',
  version: 1,
  mic: { model: 'Fifine K688', kind: 'dynamic', pattern: 'cardioid', address: 'end' },
  takes: Array.from({ length: takes }, () => ({ step: 'c8' as const, analysis: analysis(tones, rel) })),
  suggestion: null,
})

const decoded = (url: string): CommunitySummary =>
  JSON.parse(new URL(url).searchParams.get('summary') ?? 'null') as CommunitySummary

describe('buildShareUrl', () => {
  it('pre-fills the issue form with the minified summary', () => {
    const s = summary(2)
    const { url, truncated } = buildShareUrl(s)
    expect(truncated).toBe(false)
    expect(url.startsWith('https://github.com/dev-vinicius-andrade/voice-check-bench/issues/new?template=mic-result.yml&')).toBe(true)
    const q = new URL(url).searchParams
    expect(q.get('title')).toBe('Mic result: Fifine K688')
    expect(q.get('summary')).toBe(JSON.stringify(s))
    expect(decoded(url)).toEqual(s)
  })

  it('rounds numbers to integers first when the link is too long', () => {
    const { url, truncated } = buildShareUrl(summary(12, 6, 9))
    expect(truncated).toBe(false)
    expect(url.length).toBeLessThanOrEqual(MAX_SHARE_URL)
    const out = decoded(url)
    expect(out.takes[0].analysis.snr).toBe(39)
    expect(Number.isInteger(out.takes[0].analysis.rel[1])).toBe(true)
  })

  it('then keeps 3 tones per take but never drops rel (the aggregator needs it)', () => {
    const r = buildShareUrl(summary(14, 6, 60))
    if (!r.truncated) {
      const out = decoded(r.url)
      expect(out.takes[0].analysis.tones.length).toBeLessThanOrEqual(3)
      expect(out.takes[0].analysis.rel.length).toBeGreaterThan(0)
    } else {
      expect(new URL(r.url).searchParams.has('summary')).toBe(false)
    }
  })

  it('falls back to the blank form when nothing fits', () => {
    const { url, truncated } = buildShareUrl(summary(200, 6, 9))
    expect(truncated).toBe(true)
    expect(new URL(url).searchParams.has('summary')).toBe(false)
    expect(new URL(url).searchParams.get('title')).toBe('Mic result: Fifine K688')
  })
})
