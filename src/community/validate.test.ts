import { describe, expect, it } from 'vitest'
import { extractSummaryFromIssueBody, parseSummary, parseSummaryDetailed } from './validate'
import { summary, take } from './testFixtures'

// Intentionally invalid inputs are built as plain JSON-like objects (unknown), like a parsed issue body.
const base = () => summary('A', [take('c2', 30)])
const withTake = (patch: Record<string, unknown>): unknown => ({ ...base(), takes: [{ ...take('c2', 30), ...patch }] })
const withAnalysis = (patch: Record<string, unknown>): unknown => withTake({ analysis: { ...take('c2', 30).analysis, ...patch } })
const withSuggestion = (patch: Record<string, unknown>): unknown => ({ ...base(), suggestion: { ...base().suggestion, ...patch } })
const withComp = (patch: Record<string, unknown>): unknown => withSuggestion({ comp: { ...base().suggestion?.comp, ...patch } })
const eq0 = () => base().suggestion?.eq[0]

describe('parseSummary', () => {
  it('accepts a valid summary and rebuilds it from known keys', () => {
    const s = summary('Fifine K688', [take('c2', 30), take('c8', 34)])
    const parsed = parseSummary({ ...s, extra: 'x', mic: { ...s.mic, serial: 'abc' } })
    expect(parsed).toEqual(s)
    expect(parsed).not.toHaveProperty('extra')
    expect(parsed?.mic).not.toHaveProperty('serial')
  })

  it('trims the model and accepts a null suggestion', () => {
    const s = { ...summary(' Shure SM7B  ', [take('c8', 40)]), suggestion: null }
    expect(parseSummary(s)?.mic.model).toBe('Shure SM7B')
  })

  it('accepts takes without a usable silence window (null/empty bandSnr, null noiseKind, null spread/sibP95)', () => {
    const nullBands = parseSummary(withAnalysis({ bandSnr: Array(9).fill(null), noiseKind: null, spread: null, sibP95: null }))
    expect(nullBands?.takes[0].analysis.bandSnr).toHaveLength(9)
    expect(nullBands?.takes[0].analysis.bandSnr.every(Number.isNaN)).toBe(true)
    expect(nullBands?.takes[0].analysis.noiseKind).toBeNull()
    expect(nullBands?.takes[0].analysis.spread).toBeNaN()
    expect(parseSummary(withAnalysis({ bandSnr: [], tones: [] }))?.takes[0].analysis.bandSnr).toEqual([])
    expect(parseSummary(withAnalysis({ bandSnr: [12, null, 20, 20, 20, 20, 20, 20, 20] }))).not.toBeNull()
  })

  it.each<[string, () => unknown]>([
    ['not an object', () => 'x'],
    ['wrong app', () => ({ ...base(), app: 'other' })],
    ['wrong version', () => ({ ...base(), version: 2 })],
    ['empty model', () => summary('   ', [take('c2', 30)])],
    ['model too long', () => summary('x'.repeat(81), [take('c2', 30)])],
    ['bad mic kind', () => ({ ...base(), mic: { ...base().mic, kind: 'ribbon' } })],
    ['no takes', () => summary('A', [])],
    ['six takes', () => summary('A', [take('c2', 30), take('c8', 30), take('c15', 30), take('fx', 30), take(null, 30), take(null, 30)])],
    ['bad step', () => withTake({ step: 'c4' })],
    ['snr out of range', () => summary('A', [take('c2', 130)])],
    ['null snr', () => withAnalysis({ snr: null })],
    ['null speechMed', () => withAnalysis({ speechMed: null })],
    ['noise above 0 dBFS', () => withAnalysis({ noise: 3 })],
    ['rel too short', () => withAnalysis({ rel: [0, 0, 0] })],
    ['rel empty', () => withAnalysis({ rel: [] })],
    ['rel null entry', () => withAnalysis({ rel: [null, 0, 0, 0, 0, 0, 0, 0, 0] })],
    ['bandSnr wrong length', () => withAnalysis({ bandSnr: [10, 10, 10] })],
    ['bandSnr out of range', () => withAnalysis({ bandSnr: Array(9).fill(90) })],
    ['too many tones', () => withAnalysis({ tones: Array(7).fill({ hz: 100, db: 12 }) })],
    ['tone hz out of range', () => withAnalysis({ tones: [{ hz: 5, db: 12 }] })],
    ['bad noiseKind', () => withAnalysis({ noiseKind: 'loud' })],
    ['suggestion without gate', () => withSuggestion({ gate: undefined })],
    ['comp with string field', () => withComp({ ratio: '3' })],
    ['too many eq bands', () => withSuggestion({ eq: Array(13).fill(eq0()) })],
    ['bad eq type', () => withSuggestion({ eq: [{ ...eq0(), type: 'Notch' }] })],
  ])('rejects %s', (_, make) => {
    expect(parseSummary(make())).toBeNull()
  })
})

describe('extractSummaryFromIssueBody', () => {
  const json = JSON.stringify(summary('Fifine K688', [take('c2', 30)]))

  it('reads the json block under ### Summary (issue-form markdown)', () => {
    const body = `### Summary\r\n\r\n\`\`\`json\r\n${json}\r\n\`\`\`\r\n\r\n### Notes (optional)\r\n\r\n_No response_\r\n\r\n### Consent\r\n\r\n- [X] I understand this issue is public`
    expect(parseSummary(extractSummaryFromIssueBody(body))?.mic.model).toBe('Fifine K688')
  })

  it('falls back to the raw section text and to a json block without the heading', () => {
    expect(extractSummaryFromIssueBody(`### Summary\n\n${json}\n\n### Notes (optional)\n\nhi`)).toEqual(JSON.parse(json))
    expect(extractSummaryFromIssueBody(`hello\n\n\`\`\`json\n${json}\n\`\`\``)).toEqual(JSON.parse(json))
  })

  it('returns undefined for missing or broken JSON', () => {
    expect(extractSummaryFromIssueBody('just text')).toBeUndefined()
    expect(extractSummaryFromIssueBody('### Summary\n\n```json\n{"app": \n```')).toBeUndefined()
  })
})

describe('parseSummaryDetailed', () => {
  const fenced = (s: unknown) => `### Summary\n\n\`\`\`json\n${JSON.stringify(s)}\n\`\`\``

  it('returns the same summary as parseSummary', () => {
    const s = summary('Fifine K688', [take('c2', 30)])
    expect(parseSummaryDetailed(fenced(s))).toEqual({ ok: true, summary: parseSummary(s) })
  })

  it('names the problem without echoing the body', () => {
    expect(parseSummaryDetailed('just text')).toEqual({ ok: false, problem: 'Summary block missing' })
    expect(parseSummaryDetailed('### Summary\n\n_No response_')).toEqual({ ok: false, problem: 'Summary block missing' })
    expect(parseSummaryDetailed('### Summary\n\n```json\n{"secret": \n```')).toEqual({ ok: false, problem: 'Summary is not valid JSON' })
    expect(parseSummaryDetailed(fenced(withAnalysis({ snr: 999 })))).toEqual({ ok: false, problem: 'Summary has a missing or invalid value: snr' })
    expect(parseSummaryDetailed(fenced({ ...base(), version: 2 }))).toEqual({ ok: false, problem: 'Summary has a missing or invalid value: app/version' })
  })
})
