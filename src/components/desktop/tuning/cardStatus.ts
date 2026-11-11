// Metric card values and status colours from the held live metrics. Pure: thresholds and verdicts come from the live
// scale (src/components/live/liveScale.ts) and the live hints (src/live/hints.ts), no new rules.
import { NOISY_PAUSE_DB } from '../../../live/hints'
import type { HeldMetrics } from '../../../live/hold'
import { CHOPPED_ZERO } from '../../../plain/refine'
import type { Msg } from '../../../plain/types'
import { levelColor, levelWord, toneColor, type ThemeStatus } from '../../live/liveScale'

export interface CardView {
  /** Processed value (NaN when not measured). */
  value: number
  /** Mic alone (NaN when not measured). */
  raw: number
  status: ThemeStatus | null
  problem: Msg
}

/** BANDS shown by the tone card (rumble left out, as the web live tone panel). */
const TONE_ROWS = [1, 2, 3, 4, 5, 6, 7, 8] as const
/** Under this many dB from the goal the tone counts as on the goal (toneColor's success range). */
const ON_GOAL_DB = 3

const hasHint = (m: HeldMetrics, key: string): boolean => m.hints.some((h) => h.key === `live.hint.${key}`)

export function levelCard(m: HeldMetrics): CardView {
  const word = levelWord(m.fx)
  return { value: m.fx.speechDb, raw: m.raw?.speechDb ?? NaN, status: levelColor(word), problem: { key: `live.loudness.word.${word}` } }
}

export function pausesCard(m: HeldMetrics): CardView {
  const base = { value: m.fx.pauseDb, raw: m.raw?.pauseDb ?? NaN }
  const p = (key: string, status: ThemeStatus | null): CardView => ({ ...base, status, problem: { key: `desktop.tune.cards.pauses.${key}` } })
  if (m.fx.deadSilence > CHOPPED_ZERO) return p('dead', 'error')
  if (!Number.isFinite(m.fx.pauseDb)) return p('none', null)
  if (hasHint(m, 'noiseNotReduced')) return p('notReduced', 'warning')
  if (hasHint(m, 'stillNoisy') || m.fx.pauseDb > NOISY_PAUSE_DB) return p('noisy', 'warning')
  return p('quiet', 'success')
}

/** The band furthest from the goal. */
export function toneCard(m: HeldMetrics): CardView & { band: number | null } {
  let band: number | null = null
  for (const b of TONE_ROWS) {
    const v = m.fx.tone[b]
    if (Number.isFinite(v) && (band === null || Math.abs(v) > Math.abs(m.fx.tone[band]))) band = b
  }
  if (band === null) return { value: NaN, raw: NaN, status: null, problem: { key: 'desktop.tune.cards.tone.none' }, band }
  const value = m.fx.tone[band]
  const key = Math.abs(value) < ON_GOAL_DB ? 'onGoal' : value > 0 ? 'high' : 'low'
  return { value, raw: m.raw?.tone[band] ?? NaN, status: toneColor(value), problem: { key: `desktop.tune.cards.tone.${key}` }, band }
}
