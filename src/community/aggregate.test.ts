import { describe, expect, it } from 'vitest'
import { aggregate, bestRawControl, percentile, spread } from './aggregate'
import { eqBand, summary, take } from './testFixtures'
import type { CommunitySummary } from './types'
import { extractSummaryFromIssueBody, parseSummary } from './validate'

const NOW = new Date('2026-11-09T12:00:00.000Z')
const SRC = 'https://github.com/x/y/issues?q=label%3Amic-result'

// Fifine K688: 3 distinct reports (one duplicate, one with another spelling, one with a processed take).
const r1 = summary('Fifine K688', [take('c2', 30, 6), take('c8', 34), take('c15', 28, -2), take('fx', 40)], [
  eqBand('Low Shelf', 150, -3, 2),
  eqBand('Band', 250, -2),
  eqBand('Band', 780, -9, 0.1), // notch: excluded
])
const r2 = summary('fifine-k688', [take('c2', 20, 0, -50), take('c8', 26, 3, -50)], [eqBand('Low Shelf', 150, -5, 2)], true)
const r3 = summary('Fifine K688', [take('c15', 32, 7)])
const yeti = summary('Blue Yeti', [take('c2', 25), take('c8', 22)])
const sm7b = summary('Shure SM7B', [take('c2', 40), take('c8', 38, 2)])
const noKey = summary('!!!', [take('c2', 30), take('c8', 30)])
const freeOnly = summary('Rode PodMic', [take(null, 30)])

const body = (s: unknown): string => `### Summary\n\n\`\`\`json\n${JSON.stringify(s)}\n\`\`\`\n\n### Notes (optional)\n\n_No response_`

describe('percentile / spread', () => {
  it('interpolates linearly and rounds to 0.1', () => {
    expect(percentile([20, 26, 28, 30, 32, 34], 0.25)).toBeCloseTo(26.5)
    expect(spread([20, 26, 28, 30, 32, 34])).toEqual({ median: 29, p25: 26.5, p75: 31.5 })
    expect(spread([1.234])).toEqual({ median: 1.2, p25: 1.2, p75: 1.2 })
  })
})

describe('bestRawControl', () => {
  it('uses the bestControl score (SNR penalty doubles when a control take is under 25 dB)', () => {
    expect(bestRawControl(r1)?.step).toBe('c8')
    expect(bestRawControl(r2)?.step).toBe('c8')
    expect(bestRawControl(sm7b)?.step).toBe('c2')
    expect(bestRawControl(freeOnly)).toBeNull()
  })
})

describe('aggregate', () => {
  const issues = [r1, r1, r2, r3, yeti, sm7b, noKey, freeOnly].map(body)
  issues.push(body({ ...r1, version: 2 }), body({ app: 'voice-check-bench' }), 'no json here', '### Summary\n\n```json\n{oops\n```')
  const parsed = issues.map((b) => parseSummary(extractSummaryFromIssueBody(b))).filter((s): s is CommunitySummary => s !== null)
  const index = aggregate(parsed, NOW, SRC)

  it('rejects malformed bodies, dedupes identical reports and skips empty keys / reports without control takes', () => {
    expect(parsed).toHaveLength(8)
    expect(index).toMatchObject({ version: 1, generated: '2026-11-09T12:00:00.000Z', source: SRC, reports: 5 })
    expect(index.mics.map((m) => [m.key, m.reports])).toEqual([
      ['fifinek688', 3],
      ['blueyeti', 1],
      ['shuresm7b', 1],
    ])
  })

  it('builds the per-mic stats', () => {
    const k688 = index.mics[0]
    expect(k688).toMatchObject({ model: 'Fifine K688', kind: 'dynamic', pattern: 'cardioid', address: 'end' })
    expect(k688.rawSnr).toEqual({ median: 29, p25: 26.5, p75: 31.5 })
    expect(k688.noise).toEqual({ median: -60, p25: -60, p75: -52.5 })
    expect(k688.deviations).toHaveLength(9)
    expect(k688.deviations.slice(0, 3)).toEqual([-0.4, 2.6, -0.4])
    expect(k688.bestDistance).toEqual([{ dist: '8 cm', votes: 2 }])
    expect(k688.processedSnrGain).toEqual({ median: 6, p25: 6, p75: 6 })
    expect(k688.eq).toEqual([
      { type: 'Low Shelf', freq: 150, gainMedian: -3, reports: 3 },
      { type: 'Band', freq: 250, gainMedian: -2, reports: 1 },
    ])
    expect(k688.noisyRoomShare).toBe(0.33)
  })

  it('votes for the best distance and leaves processedSnrGain null without an fx take', () => {
    const sm = index.mics.find((m) => m.key === 'shuresm7b')
    expect(sm?.bestDistance).toEqual([{ dist: '2 cm', votes: 1 }])
    expect(sm?.processedSnrGain).toBeNull()
  })

  it('keeps reports whose takes have null bandSnr / noiseKind / spread (no silence window)', () => {
    const noSilence = (snr: number, tilt = 0) => {
      const t = take('c2', snr, tilt)
      return { ...t, analysis: { ...t.analysis, bandSnr: Array(9).fill(NaN), noiseKind: null, sibP95: NaN } }
    }
    const raw = { ...summary('Rode NT-USB', []), takes: [noSilence(30), { ...noSilence(28, 2), step: 'c8' }] }
    const parsedRaw = parseSummary(extractSummaryFromIssueBody(body(raw)))
    expect(parsedRaw).not.toBeNull()
    const idx = aggregate([parsedRaw as CommunitySummary, sm7b], NOW, SRC)
    const nt = idx.mics.find((m) => m.key === 'rodentusb')
    expect(nt?.rawSnr).toEqual({ median: 29, p25: 28.5, p75: 29.5 })
    expect(nt?.deviations.every(Number.isFinite)).toBe(true)
  })

  it('returns an empty index for no input', () => {
    expect(aggregate([], NOW, SRC)).toEqual({ version: 1, generated: NOW.toISOString(), source: SRC, reports: 0, mics: [] })
  })
})
