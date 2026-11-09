// Clarity score 0..100 from one analysis (SPEC "Plain language (v0.5)"). Pure.
import { STRONG_TONE_DB } from '../audio/analyze'
import { deviations } from '../audio/reference'
import type { Analysis } from '../types'
import type { ClarityScore, MainIssue, Msg, ScorePenalties } from './types'

/** Comfortable speech median range, dBFS (same as the level check). */
export const LEVEL_LO = -26
export const LEVEL_HI = -16
/** A penalty must reach this many points to become the main issue. */
export const MAIN_MIN = 8

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
const finite = (v: number): number => (Number.isFinite(v) ? v : 0)

/** Strongest mains-hum peak in dB over its neighbours (0 when none). */
export const strongestHum = (a: Analysis): number => a.hum.reduce((m, h) => Math.max(m, h.db), 0)

/** Any steady fan/machine tone or mains hum at or above 12 dB. */
export const hasStrongTone = (a: Analysis): boolean =>
  a.tones.some((t) => t.db >= STRONG_TONE_DB) || strongestHum(a) >= STRONG_TONE_DB

export function penalties(a: Analysis): ScorePenalties {
  const noise = (Number.isFinite(a.snr) ? clamp((30 - a.snr) * 1.5, 0, 45) : 0) + (hasStrongTone(a) ? 5 : 0)

  let level = 0
  const med = a.speechMed
  if (Number.isFinite(med) && (med < LEVEL_LO || med > LEVEL_HI)) {
    const dist = med < LEVEL_LO ? LEVEL_LO - med : med - LEVEL_HI
    level = Math.min(15, 2 * dist)
  }
  if (a.clip > 0) level += 15

  const dv = deviations(a.rel)
  let excess = 0
  for (let i = 1; i <= 7; i++) excess += Math.max(0, Math.abs(finite(dv[i])) - 3)
  const tone = Math.min(25, 1.2 * excess)

  const consistency = a.spread > 8 ? Math.min(10, 1.5 * (a.spread - 8)) : 0

  return { noise, level, tone, consistency }
}

/** Largest of noise / level / tone (first wins on ties) when it is at least 8 points, else 'none'. */
export function mainIssue(p: ScorePenalties): MainIssue {
  let main: MainIssue = 'none'
  let best = MAIN_MIN
  for (const k of ['noise', 'level', 'tone'] as const) {
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

export function clarityScore(a: Analysis): ClarityScore {
  const p = penalties(a)
  const total = p.noise + p.level + p.tone + p.consistency
  const score = Math.round(clamp(100 - total, 0, 100))
  const main = mainIssue(p)
  const band = scoreBand(score)
  const path = band === 'clear' || band === 'good' ? band : `${band}.${main}`
  const headline: Msg = { key: `plain.score.${path}` }
  const explain: Msg = { key: `plain.score.explain.${path}` }
  return { score, main, headline, explain, penalties: p }
}
