import { describe, expect, it } from 'vitest'
import { codeSpan, REVIEW_MARKER, reviewComment, reviewIssues, stableStringify, summaryHash } from './review'
import { summary, take } from './testFixtures'
import type { CommunityIssue, CommunitySummary, MicAliases } from './types'

const NONE: MicAliases = { aliases: {}, distinct: [] }
const body = (s: unknown): string => `### Summary\n\n\`\`\`json\n${JSON.stringify(s)}\n\`\`\`\n\n### Notes (optional)\n\n_No response_`
const issue = (number: number, s: unknown, patch: Partial<CommunityIssue> = {}): CommunityIssue => ({
  number,
  author: `user${number}`,
  body: typeof s === 'string' ? s : body(s),
  labels: ['mic-result'],
  state: 'open',
  votes: 0,
  ...patch,
})

const k688 = summary('Fifine K688', [take('c2', 30), take('c8', 34)])
const k688b = summary('K-688', [take('c2', 28), take('c8', 31)])
const sm7b = summary('Shure SM7B', [take('c2', 40)])

describe('summaryHash', () => {
  it('ignores key order and changes with the content', () => {
    const reversed = Object.fromEntries(Object.entries(k688).reverse()) as unknown as CommunitySummary
    expect(Object.keys(reversed)[0]).not.toBe(Object.keys(k688)[0])
    expect(summaryHash(reversed)).toBe(summaryHash(k688))
    expect(summaryHash(k688)).toMatch(/^[0-9a-f]{16}$/)
    expect(summaryHash(k688b)).not.toBe(summaryHash(k688))
  })

  it('writes non-finite numbers as null', () => {
    expect(stableStringify({ b: [Number.NaN, 1], a: undefined, c: 'x' })).toBe('{"b":[null,1],"c":"x"}')
  })
})

describe('reviewIssues', () => {
  it('accepts new and matching mics, in issue-number order whatever the input order', () => {
    const issues = [issue(3, k688b), issue(1, k688), issue(2, sm7b)]
    const v = reviewIssues(issues, NONE)
    expect([...v.keys()]).toEqual([1, 2, 3])
    expect(v.get(1)).toEqual({ kind: 'accepted', mic: { key: 'fifinek688', model: 'Fifine K688', how: 'new' }, replaces: null })
    expect(v.get(2)).toMatchObject({ kind: 'accepted', mic: { key: 'shuresm7b', how: 'new' } })
    expect(v.get(3)).toEqual({ kind: 'accepted', mic: { key: 'fifinek688', model: 'Fifine K688', how: 'fuzzy' }, replaces: null })
  })

  it('uses aliases', () => {
    const v = reviewIssues([issue(1, k688b)], { aliases: { k688: 'fifinek688' }, distinct: [] })
    expect(v.get(1)).toMatchObject({ kind: 'accepted', mic: { key: 'fifinek688', how: 'alias' } })
  })

  it('reports why a summary is invalid', () => {
    const v = reviewIssues(
      [
        issue(1, 'no summary here'),
        issue(2, '### Summary\n\n```json\n{oops\n```'),
        issue(3, { ...k688, mic: { ...k688.mic, model: '' } }),
        issue(4, summary('Fifine K688', [take(null, 30), take('fx', 40)])),
        issue(5, summary('!!!', [take('c2', 30)])),
        issue(6, '### Summary\n\n_No response_\n\n### Notes (optional)\n\nhi'),
      ],
      NONE,
    )
    expect([...v.values()]).toEqual([
      { kind: 'invalid', problem: 'Summary block missing' },
      { kind: 'invalid', problem: 'Summary is not valid JSON' },
      { kind: 'invalid', problem: 'Summary has a missing or invalid value: mic.model' },
      { kind: 'invalid', problem: 'Summary has no raw control take (2, 8 or 15 cm)' },
      { kind: 'invalid', problem: 'Summary has a missing or invalid value: mic.model (no letters or digits)' },
      { kind: 'invalid', problem: 'Summary block missing' },
    ])
  })

  it('marks identical summaries as duplicates of the counting issue, but not after an invalid or rejected one', () => {
    const v = reviewIssues(
      [issue(1, sm7b, { labels: ['mic-result', 'rejected'] }), issue(2, k688), issue(3, k688), issue(4, sm7b), issue(5, sm7b)],
      NONE,
    )
    expect(v.get(1)).toEqual({ kind: 'rejected' })
    expect(v.get(3)).toEqual({ kind: 'duplicate', of: 2 })
    expect(v.get(4)?.kind).toBe('accepted')
    expect(v.get(5)).toEqual({ kind: 'duplicate', of: 4 })
  })

  it('lets a newer report by the same author replace the older one for the same mic', () => {
    const v = reviewIssues(
      [
        issue(1, k688, { author: 'ana' }),
        issue(2, sm7b, { author: 'ana' }),
        issue(3, k688b, { author: 'ana' }),
        issue(4, k688, { author: 'bob' }),
        issue(5, summary('Fifine K688', [take('c8', 20)]), { author: '' }),
        issue(6, summary('Fifine K688', [take('c8', 21)]), { author: '' }),
      ],
      NONE,
    )
    expect(v.get(2)).toMatchObject({ kind: 'accepted', replaces: null })
    expect(v.get(3)).toMatchObject({ kind: 'accepted', mic: { key: 'fifinek688' }, replaces: 1 })
    // #1 no longer counts, so the same summary is accepted again
    expect(v.get(4)).toMatchObject({ kind: 'accepted', replaces: null })
    // no author (offline fixtures): never a replacement
    expect(v.get(6)).toMatchObject({ kind: 'accepted', replaces: null })
  })

  it('ignores the labels the checker sets', () => {
    const plain = reviewIssues([issue(1, k688), issue(2, k688)], NONE)
    const labelled = reviewIssues([issue(1, k688, { labels: ['invalid'] }), issue(2, k688, { labels: ['accepted', 'duplicate'] })], NONE)
    expect(labelled).toEqual(plain)
  })
})

describe('reviewComment', () => {
  const REPO = 'me/repo'

  it('starts with the marker and thanks the author for an accepted report', () => {
    const c = reviewComment({ kind: 'accepted', mic: { key: 'fifinek688', model: 'Fifine K688', how: 'new' }, replaces: null }, REPO)
    expect(c.startsWith(`${REVIEW_MARKER}\n`)).toBe(true)
    expect(c).toContain('counted for **`Fifine K688`** (new mic)')
    expect(c).toContain('https://voicecb.app.andradev.io/#/community')
    expect(c).not.toContain('replaces')
  })

  it('names the existing mic for a fuzzy or alias match and links the replaced issue', () => {
    const c = reviewComment({ kind: 'accepted', mic: { key: 'fifinek688', model: 'Fifine K688', how: 'fuzzy' }, replaces: 4 }, REPO)
    expect(c).toContain('matched to existing mic **`Fifine K688`**')
    expect(c).toContain('[#4](https://github.com/me/repo/issues/4)')
  })

  it('explains invalid and duplicate verdicts', () => {
    const inv = reviewComment({ kind: 'invalid', problem: 'Summary block missing' }, REPO)
    expect(inv).toContain('Summary block missing')
    expect(inv).toContain('Edit the issue to fix it and the check runs again.')
    expect(reviewComment({ kind: 'duplicate', of: 7 }, REPO)).toContain('same results as [#7](https://github.com/me/repo/issues/7)')
  })

  it('renders the untrusted model name as a plain code span', () => {
    expect(codeSpan('<img src=x> `@admin` [x](http://e.com)\n**b**')).toBe("`<img src=x> '@admin' [x](http://e.com) **b**`")
    expect(codeSpan('``')).toBe("`''`")
    expect(codeSpan(' \n ')).toBe('`?`')
  })
})
