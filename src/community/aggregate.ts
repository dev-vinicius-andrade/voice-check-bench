// Community index built from reviewed shared summaries (SPEC "Community results via GitHub issues"). Pure.
// Accepted, not replaced reports are grouped by their matched mic (review.ts) and reduced to medians/quartiles.
import { deviations } from '../audio/reference'
import { STEPS } from '../session/steps'
import { isNotch } from '../settings/suggest'
import type { StepKey } from '../types'
import {
  micKey,
  type CommunityIndex,
  type CommunityMicStats,
  type CommunitySolution,
  type CommunitySummary,
  type ReviewVerdict,
  type Spread,
} from './types'

/** One mic-result issue after review: its parsed summary, 👍 votes and the checker's verdict. */
export interface ReviewedReport {
  issue: number
  votes: number
  summary: CommunitySummary
  verdict: ReviewVerdict
}

type TakeRow = CommunitySummary['takes'][number]
type RawControl = TakeRow & { step: 'c2' | 'c8' | 'c15' }
type EqStat = CommunityMicStats['eq'][number]

const CONTROL_KEYS: readonly StepKey[] = ['c2', 'c8', 'c15']
const isRawControl = (t: TakeRow): t is RawControl => t.step !== null && CONTROL_KEYS.includes(t.step)
/** The report has at least one raw control take (c2/c8/c15); reports without one are never counted. */
export const hasRawControl = (s: CommunitySummary): boolean => s.takes.some(isRawControl)
const STEP_DIST = new Map(STEPS.map((s) => [s.key, s.dist]))
const DIST_ORDER = STEPS.map((s) => s.dist).filter((d): d is string => d !== null)

const r1 = (v: number): number => Math.round(v * 10) / 10
const r2 = (v: number): number => Math.round(v * 100) / 100

/** Percentile with linear interpolation between closest ranks (p in 0..1). Skips NaN (JSON null); NaN when nothing is left. */
export function percentile(values: readonly number[], p: number): number {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!s.length) return Number.NaN
  const pos = p * (s.length - 1)
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return s[lo] + (s[hi] - s[lo]) * (pos - lo)
}

/** median / p25 / p75, rounded to 0.1. */
export const spread = (values: readonly number[]): Spread => ({
  median: r1(percentile(values, 0.5)),
  p25: r1(percentile(values, 0.25)),
  p75: r1(percentile(values, 0.75)),
})

/** Most common value; ties go to the one seen first. */
export function mostCommon<T>(values: readonly T[]): T {
  const counts = new Map<T, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best = values[0]
  for (const [v, n] of counts) if (n > (counts.get(best) ?? 0)) best = v
  return best
}

/**
 * Display name of a mic group: the most common spelling among those whose own micKey is the group key (so a
 * fuzzy or alias match like "K-688" never names the "fifinek688" group), else among all spellings.
 */
export function displayModel(key: string, models: readonly string[]): string {
  const own = models.filter((m) => micKey(m) === key)
  return mostCommon(own.length ? own : models)
}

/** Same score as session/bestControl: |boom|+|warmth|+|mud|+|body| + SNR penalty (doubled in a noisy room). */
const score = (a: TakeRow['analysis'], noisy: boolean): number => {
  const d = deviations(a.rel)
  const snrPenalty = Math.max(0, 40 - a.snr) / (noisy ? 1 : 2)
  return Math.abs(d[1]) + Math.abs(d[2]) + Math.abs(d[3]) + Math.abs(d[4]) + snrPenalty
}

/** Lowest-score raw control take of one report (null without one). */
export function bestRawControl(s: CommunitySummary): RawControl | null {
  const controls = s.takes.filter(isRawControl)
  if (!controls.length) return null
  const noisy = controls.some((t) => t.analysis.snr < 25)
  return controls.reduce((best, t) => (score(t.analysis, noisy) < score(best.analysis, noisy) ? t : best))
}

function eqStats(reports: readonly CommunitySummary[]): EqStat[] {
  const groups = new Map<string, { type: EqStat['type']; freq: number; gains: number[] }>()
  for (const r of reports) {
    const seen = new Set<string>()
    for (const e of r.suggestion?.eq ?? []) {
      const key = `${e.type}|${e.freq}`
      if (isNotch(e) || seen.has(key)) continue
      seen.add(key)
      const g = groups.get(key) ?? { type: e.type, freq: e.freq, gains: [] }
      g.gains.push(e.gain)
      groups.set(key, g)
    }
  }
  return [...groups.values()]
    .map((g) => ({ type: g.type, freq: g.freq, gainMedian: r1(percentile(g.gains, 0.5)), reports: g.gains.length }))
    .sort((a, b) => b.reports - a.reports || a.freq - b.freq)
}

/** Plugin names a shared chain may hold; anything else is dropped. */
const CHAIN_PLUGINS = new Set(['ReaFIR', 'ReaEQ', 'ReaComp', 'ReaGate'])
const DIST_TEXT = /^\d{1,2} cm$/

/**
 * A shared suggestion as published in mics.json: numbers and enums only. Free text from the issue body (hints,
 * EQ reasons, noise-reduction steps) is dropped, `dist` is kept only as "<n> cm", `chain` only with known plugins.
 */
export function publicSuggestion(s: NonNullable<CommunitySummary['suggestion']>): CommunitySolution['suggestion'] {
  return {
    ...s,
    gainHint: '',
    noiseHint: '',
    dist: DIST_TEXT.test(s.dist) ? s.dist : '',
    gate: { ...s.gate },
    eq: s.eq.map((e) => ({ type: e.type, freq: e.freq, gain: e.gain, bw: e.bw, why: '' })),
    comp: { ...s.comp },
    noiseReduction: s.noiseReduction ? { plugin: s.noiseReduction.plugin, steps: [], alternatives: [] } : null,
    chain: s.chain.filter((p) => CHAIN_PLUGINS.has(p)),
  }
}

/** One solution per report with a suggestion: most votes first, then the newest issue. */
function solutions(reports: readonly ReviewedReport[]): CommunitySolution[] {
  return reports
    .flatMap(({ issue, votes, summary }): CommunitySolution[] => {
      const best = bestRawControl(summary)
      if (!summary.suggestion || !best) return []
      const fx = summary.takes.find((t) => t.step === 'fx')
      return [
        {
          issue,
          votes,
          style: summary.goalStyle ?? null,
          noisyRoom: summary.suggestion.noisyRoom,
          rawSnr: r1(best.analysis.snr),
          dist: STEP_DIST.get(best.step) as string,
          snrGain: fx ? r1(fx.analysis.snr - best.analysis.snr) : null,
          suggestion: publicSuggestion(summary.suggestion),
        },
      ]
    })
    .sort((a, b) => b.votes - a.votes || b.issue - a.issue)
}

/** Stats for one mic. Every report must have at least one raw control take. */
function micStats(key: string, group: readonly ReviewedReport[]): CommunityMicStats {
  const reports = group.map((r) => r.summary)
  const controls = reports.flatMap((r) => r.takes.filter(isRawControl))
  const picks = reports.map((r) => ({ report: r, best: bestRawControl(r) as RawControl }))
  const devs = picks.map((p) => deviations(p.best.analysis.rel))
  const votes = new Map<string, number>()
  for (const { report, best } of picks) {
    // like bestControl(): a distance verdict needs at least 2 control takes
    if (report.takes.filter(isRawControl).length < 2) continue
    const dist = STEP_DIST.get(best.step) as string
    votes.set(dist, (votes.get(dist) ?? 0) + 1)
  }
  const gains = picks.flatMap(({ report, best }) => {
    const fx = report.takes.find((t) => t.step === 'fx')
    return fx ? [fx.analysis.snr - best.analysis.snr] : []
  })
  return {
    key,
    model: displayModel(key, reports.map((r) => r.mic.model)),
    reports: reports.length,
    kind: mostCommon(reports.map((r) => r.mic.kind)),
    pattern: mostCommon(reports.map((r) => r.mic.pattern)),
    address: mostCommon(reports.map((r) => r.mic.address)),
    rawSnr: spread(controls.map((t) => t.analysis.snr)),
    noise: spread(controls.map((t) => t.analysis.noise)),
    deviations: devs[0].map((_, i) => r1(percentile(devs.map((d) => d[i]), 0.5))),
    bestDistance: [...votes]
      .map(([dist, n]) => ({ dist, votes: n }))
      .sort((a, b) => b.votes - a.votes || DIST_ORDER.indexOf(a.dist) - DIST_ORDER.indexOf(b.dist)),
    processedSnrGain: gains.length ? spread(gains) : null,
    eq: eqStats(reports),
    noisyRoomShare: r2(reports.filter((r) => r.suggestion?.noisyRoom).length / reports.length),
    solutions: solutions(group),
  }
}

/**
 * CommunityIndex from reviewed reports. Only accepted reports count, minus those a newer report by the same
 * person replaced; they are grouped by the matched mic key (verdict.mic.key). Identical summaries still count
 * once, and reports with an empty key or without a raw control take (c2/c8/c15) are left out (review.ts already
 * marks those). Mics: most reports first, then model.
 */
export function aggregate(reports: readonly ReviewedReport[], now: Date, source: string): CommunityIndex {
  const replaced = new Set(reports.flatMap((r) => (r.verdict.kind === 'accepted' && r.verdict.replaces !== null ? [r.verdict.replaces] : [])))
  const seen = new Set<string>()
  const byMic = new Map<string, ReviewedReport[]>()
  for (const r of [...reports].sort((a, b) => a.issue - b.issue)) {
    if (r.verdict.kind !== 'accepted' || replaced.has(r.issue)) continue
    const json = JSON.stringify(r.summary)
    if (seen.has(json)) continue
    seen.add(json)
    const key = r.verdict.mic.key
    if (!key || !hasRawControl(r.summary)) continue
    byMic.set(key, [...(byMic.get(key) ?? []), r])
  }
  const mics = [...byMic].map(([key, group]) => micStats(key, group))
  mics.sort((a, b) => b.reports - a.reports || (a.model < b.model ? -1 : a.model > b.model ? 1 : 0))
  return {
    version: 1,
    generated: now.toISOString(),
    source,
    reports: mics.reduce((n, m) => n + m.reports, 0),
    mics,
  }
}
