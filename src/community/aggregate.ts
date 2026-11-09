// Community index built from valid shared summaries (SPEC "Community results via GitHub issues"). Pure.
// Reports are deduped (identical JSON), grouped by micKey(model) and reduced to medians/quartiles.
import { deviations } from '../audio/reference'
import { STEPS } from '../session/steps'
import { isNotch } from '../settings/suggest'
import type { StepKey } from '../types'
import { micKey, type CommunityIndex, type CommunityMicStats, type CommunitySummary, type Spread } from './types'

type TakeRow = CommunitySummary['takes'][number]
type RawControl = TakeRow & { step: 'c2' | 'c8' | 'c15' }
type EqStat = CommunityMicStats['eq'][number]

const CONTROL_KEYS: readonly StepKey[] = ['c2', 'c8', 'c15']
const isRawControl = (t: TakeRow): t is RawControl => t.step !== null && CONTROL_KEYS.includes(t.step)
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
function mostCommon<T>(values: readonly T[]): T {
  const counts = new Map<T, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best = values[0]
  for (const [v, n] of counts) if (n > (counts.get(best) ?? 0)) best = v
  return best
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

/** Stats for one mic. Every report must have at least one raw control take. */
function micStats(key: string, reports: readonly CommunitySummary[]): CommunityMicStats {
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
    model: mostCommon(reports.map((r) => r.mic.model)),
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
  }
}

/**
 * CommunityIndex from parsed summaries. Identical summaries count once; reports whose model has an empty
 * micKey, or that have no raw control take (c2/c8/c15), are left out. Mics: most reports first, then model.
 */
export function aggregate(summaries: readonly CommunitySummary[], now: Date, source: string): CommunityIndex {
  const seen = new Set<string>()
  const byMic = new Map<string, CommunitySummary[]>()
  for (const s of summaries) {
    const json = JSON.stringify(s)
    if (seen.has(json)) continue
    seen.add(json)
    const key = micKey(s.mic.model)
    if (!key || !s.takes.some(isRawControl)) continue
    byMic.set(key, [...(byMic.get(key) ?? []), s])
  }
  const mics = [...byMic].map(([key, reports]) => micStats(key, reports))
  mics.sort((a, b) => b.reports - a.reports || (a.model < b.model ? -1 : a.model > b.model ? 1 : 0))
  return {
    version: 1,
    generated: now.toISOString(),
    source,
    reports: mics.reduce((n, m) => n + m.reports, 0),
    mics,
  }
}
