// Clarity score 0..100 from one analysis (SPEC "Plain language (v0.5)"). Pure.
import { STRONG_TONE_DB } from '../audio/analyze'
import { OVER_SWITCH_WARN, OVER_ZERO_WARN } from '../audio/diagnose'
import { targetDeviations } from '../audio/reference'
import type { Analysis, VoiceGoal } from '../types'
import { compareProcessed } from './compare'
import type { ClarityScore, MainIssue, Msg, ScorePenalties } from './types'

/** Comfortable speech median range, dBFS (same as the level check). */
export const LEVEL_LO = -26
export const LEVEL_HI = -16
/** A penalty must reach this many points to become the main issue. */
export const MAIN_MIN = 8
/** SNR above this adds nothing to the noise part (v0.8: a digital-silence floor must not look like a perfect room). */
export const SNR_CAP = 45
/** Over-processing penalty: up to 35 points, full at 30 % exact-zero samples or 18 gate flips per 10 s. */
export const OVER_MAX = 35
export const OVER_ZERO_FULL = 0.3
export const OVER_SWITCH_FULL = 18
/** Points per regression of a processed take against its raw control (quieter, thin, harsh, chopped). */
export const REGRESSION_POINTS = 10

/** Options for scoring: the raw control of the same session (processed take), the voice goal (default natural). */
export interface ScoreOptions {
  raw?: Analysis | null
  /** Tone is judged against the goal's target curve; regressions vs the raw take are not (they compare raw and processed). */
  goal?: VoiceGoal
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
const finite = (v: number): number => (Number.isFinite(v) ? v : 0)

/** Strongest mains-hum peak in dB over its neighbours (0 when none). */
export const strongestHum = (a: Analysis): number => a.hum.reduce((m, h) => Math.max(m, h.db), 0)

/** Any steady fan/machine tone or mains hum at or above 12 dB. */
export const hasStrongTone = (a: Analysis): boolean =>
  a.tones.some((t) => t.db >= STRONG_TONE_DB) || strongestHum(a) >= STRONG_TONE_DB

/** 0..35 from the share of exact-zero samples and the gate flips per 10 s (0 at the warn thresholds 5 % / 6). */
export function overprocessingPenalty(a: Analysis): number {
  const z = clamp(((a.zeroRatio ?? 0) - OVER_ZERO_WARN) / (OVER_ZERO_FULL - OVER_ZERO_WARN), 0, 1)
  const g = clamp(((a.gateSwitches ?? 0) - OVER_SWITCH_WARN) / (OVER_SWITCH_FULL - OVER_SWITCH_WARN), 0, 1)
  return OVER_MAX * Math.max(z, g)
}

export function penalties(a: Analysis, opts: ScoreOptions = {}): ScorePenalties {
  const snr = Math.min(a.snr, SNR_CAP)
  const noise = (Number.isFinite(snr) ? clamp((30 - snr) * 1.5, 0, 45) : 0) + (hasStrongTone(a) ? 5 : 0)

  let level = 0
  const med = a.speechMed
  if (Number.isFinite(med) && (med < LEVEL_LO || med > LEVEL_HI)) {
    const dist = med < LEVEL_LO ? LEVEL_LO - med : med - LEVEL_HI
    level = Math.min(15, 2 * dist)
  }
  if (a.clip > 0) level += 15

  const dv = targetDeviations(a.rel, opts.goal)
  let excess = 0
  for (let i = 1; i <= 7; i++) excess += Math.max(0, Math.abs(finite(dv[i])) - 3)
  const tone = Math.min(25, 1.2 * excess)

  const consistency = a.spread > 8 ? Math.min(10, 1.5 * (a.spread - 8)) : 0

  const regressions = opts.raw ? compareProcessed(opts.raw, a).regressions.length : 0
  const overprocessed = overprocessingPenalty(a) + REGRESSION_POINTS * regressions

  return { noise, level, tone, consistency, overprocessed }
}

/** Largest of over-processing / noise / level / tone (first wins on ties) when it is at least 8 points, else 'none'. */
export function mainIssue(p: ScorePenalties): MainIssue {
  let main: MainIssue = 'none'
  let best = MAIN_MIN
  for (const k of ['overprocessed', 'noise', 'level', 'tone'] as const) {
    if (p[k] >= best && (main === 'none' || p[k] > best)) {
      main = k
      best = p[k]
    }
  }
  return main
}

/** Headline band for a score: ≥ 85 clear · 70–84 good · 50–69 ok · < 50 hard. */
export function scoreBand(score: number): 'clear' | 'good' | 'ok' | 'hard' {
  if (score >= 85) return 'clear'
  if (score >= 70) return 'good'
  if (score >= 50) return 'ok'
  return 'hard'
}

/**
 * Clarity score of a take. Pass `raw` (the session's raw control) when `a` is the processed take: each regression
 * (quieter, thin, harsh, chopped) then costs 10 points. When over-processing is the biggest penalty the headline
 * says so whatever the score band.
 */
export function clarityScore(a: Analysis, opts: ScoreOptions = {}): ClarityScore {
  const p = penalties(a, opts)
  const total = p.noise + p.level + p.tone + p.consistency + p.overprocessed
  const score = Math.round(clamp(100 - total, 0, 100))
  const main = mainIssue(p)
  const band = scoreBand(score)
  const path = main === 'overprocessed' ? 'overprocessed' : band === 'clear' || band === 'good' ? band : `${band}.${main}`
  const headline: Msg = { key: `plain.score.${path}` }
  const explain: Msg = { key: `plain.score.explain.${path}` }
  return { score, main, headline, explain, penalties: p }
}
