import { describe, expect, it } from 'vitest'
import { aggregate, bestRawControl, displayModel, percentile, publicSuggestion, spread, type ReviewedReport } from './aggregate'
import { reviewedReports, reviewIssues } from './review'
import { eqBand, summary, take } from './testFixtures'
import { micKey, type CommunityIssue, type CommunitySummary } from './types'
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
const NO_ALIASES = { aliases: {}, distinct: [] }
const issue = (number: number, b: string, patch: Partial<CommunityIssue> = {}): CommunityIssue => ({
  number,
  author: `user${number}`,
  body: b,
  labels: ['mic-result'],
  state: 'open',
  votes: 0,
  ...patch,
})
/** Issues → review → aggregation input, as tools/community/aggregate.ts does. */
const reviewed = (issues: CommunityIssue[]): ReviewedReport[] => reviewedReports(issues, reviewIssues(issues, NO_ALIASES))
/** A report accepted as a new mic under its own key. */
const accepted = (s: CommunitySummary, n: number, votes = 0): ReviewedReport => ({
  issue: n,
  votes,
  summary: s,
  verdict: { kind: 'accepted', mic: { key: micKey(s.mic.model), model: s.mic.model, how: 'new' }, replaces: null },
})

describe('percentile / spread', () => {
  it('interpolates linearly and rounds to 0.1', () => {
    expect(percentile([20, 26, 28, 30, 32, 34], 0.25)).toBeCloseTo(26.5)
    expect(spread([20, 26, 28, 30, 32, 34])).toEqual({ median: 29, p25: 26.5, p75: 31.5 })
    expect(spread([1.234])).toEqual({ median: 1.2, p25: 1.2, p75: 1.2 })
  })
})

describe('displayModel', () => {
  it('prefers spellings whose own key is the group key, then the most common one', () => {
    expect(displayModel('fifinek688', ['K-688', 'k688', 'fifine k688', 'Fifine K688', 'Fifine K688'])).toBe('Fifine K688')
    expect(displayModel('fifinek688', ['K-688', 'fifine k688'])).toBe('fifine k688')
    expect(displayModel('fifinek688', ['K-688', 'k688'])).toBe('K-688')
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
  const bodies = [r1, r1, r2, r3, yeti, sm7b, noKey, freeOnly].map(body)
  bodies.push(body({ ...r1, version: 2 }), body({ app: 'voice-check-bench' }), 'no json here', '### Summary\n\n```json\n{oops\n```')
  const parsed = bodies.map((b) => parseSummary(extractSummaryFromIssueBody(b))).filter((s): s is CommunitySummary => s !== null)
  const reports = reviewed(bodies.map((b, i) => issue(i + 1, b)))
  const index = aggregate(reports, NOW, SRC)

  it('rejects malformed bodies, dedupes identical reports and skips empty keys / reports without control takes', () => {
    expect(parsed).toHaveLength(8)
    expect(reports.map((r) => r.issue)).toEqual([1, 3, 4, 5, 6])
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
    const idx = aggregate([accepted(parsedRaw as CommunitySummary, 1), accepted(sm7b, 2)], NOW, SRC)
    const nt = idx.mics.find((m) => m.key === 'rodentusb')
    expect(nt?.rawSnr).toEqual({ median: 29, p25: 28.5, p75: 29.5 })
    expect(nt?.deviations.every(Number.isFinite)).toBe(true)
  })

  it('returns an empty index for no input', () => {
    expect(aggregate([], NOW, SRC)).toEqual({ version: 1, generated: NOW.toISOString(), source: SRC, reports: 0, mics: [] })
  })

  it('counts only accepted reports that were not replaced, grouped by the matched mic', () => {
    const k = summary('K-688', [take('c2', 24), take('c8', 30)])
    const newer = summary('Fifine K688', [take('c2', 36), take('c8', 38)])
    const idx = aggregate(
      reviewed([
        issue(1, body(r1), { author: 'ana' }),
        issue(2, body(k)),
        issue(3, body(newer), { author: 'ana' }),
        issue(4, body(yeti), { labels: ['mic-result', 'rejected'] }),
        issue(5, body(r3), { labels: ['mic-result', 'accepted', 'invalid'] }),
      ]),
      NOW,
      SRC,
    )
    expect(idx.reports).toBe(3)
    expect(idx.mics.map((m) => [m.key, m.model, m.reports])).toEqual([['fifinek688', 'Fifine K688', 3]])
    expect(idx.mics[0].solutions?.map((s) => s.issue)).toEqual([5, 3, 2])
  })

  it('ignores verdicts other than accepted and reports replaced by a newer one', () => {
    const rep = (n: number, verdict: ReviewedReport['verdict']): ReviewedReport => ({ ...accepted(yeti, n), verdict })
    const idx = aggregate(
      [
        rep(1, { kind: 'invalid', problem: 'x' }),
        rep(2, { kind: 'duplicate', of: 9 }),
        rep(3, { kind: 'rejected' }),
        accepted(sm7b, 4),
        { ...accepted(r3, 5), verdict: { kind: 'accepted', mic: { key: 'shuresm7b', model: 'Shure SM7B', how: 'alias' }, replaces: 4 } },
      ],
      NOW,
      SRC,
    )
    expect(idx.mics.map((m) => [m.key, m.model, m.reports])).toEqual([['shuresm7b', 'Fifine K688', 1]])
  })
})

describe('solutions', () => {
  const withText = {
    ...r1,
    goalStyle: 'warm' as const,
    suggestion: {
      ...(r1.suggestion as NonNullable<CommunitySummary['suggestion']>),
      gainHint: 'visit example.com',
      noiseHint: '<b>hi</b>',
      dist: 'very close',
      eq: [{ ...eqBand('Band', 250, -2), why: '@someone' }],
      noiseReduction: { plugin: 'ReaFIR' as const, steps: ['spam'], alternatives: ['spam'] },
      chain: ['ReaFIR', 'EvilPlugin', 'ReaGate'],
    },
  }
  const noSuggestion = { ...summary('Fifine K688', [take('c8', 30)]), suggestion: null }
  const idx = aggregate([accepted(withText, 1, 2), accepted(r2, 2, 5), accepted(noSuggestion, 3, 9), accepted(r3, 4, 2)], NOW, SRC)
  const sols = idx.mics[0].solutions ?? []

  it('lists one solution per report with a suggestion, most votes first, then the newest issue', () => {
    expect(idx.mics[0].reports).toBe(4)
    expect(sols.map((s) => [s.issue, s.votes])).toEqual([[2, 5], [4, 2], [1, 2]])
  })

  it('takes distance and SNR from the best raw control take, the gain from the fx take', () => {
    expect(sols[2]).toMatchObject({ style: 'warm', noisyRoom: false, rawSnr: 34, dist: '8 cm', snrGain: 6 })
    expect(sols[0]).toMatchObject({ style: null, noisyRoom: true, rawSnr: 26, dist: '8 cm', snrGain: null })
    expect(sols[1]).toMatchObject({ rawSnr: 32, dist: '15 cm' })
  })

  it('drops free text from the published suggestion', () => {
    const s = sols[2].suggestion
    expect(s).toMatchObject({ gainHint: '', noiseHint: '', dist: '', chain: ['ReaFIR', 'ReaGate'] })
    expect(s.eq).toEqual([{ type: 'Band', freq: 250, gain: -2, bw: 1.5, why: '' }])
    expect(s.noiseReduction).toEqual({ plugin: 'ReaFIR', steps: [], alternatives: [] })
    expect(s.gate).toEqual(withText.suggestion.gate)
    expect(publicSuggestion(r1.suggestion as NonNullable<CommunitySummary['suggestion']>).dist).toBe('8 cm')
  })
})
