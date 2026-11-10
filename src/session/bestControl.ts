// Best control take selection ported from the prototype (docs/prototype/voice-check.html); noisy-room weighting per SPEC v1.1. Pure.
import { targetDeviations } from '../audio/reference'
import { DEFAULT_GOAL, isAnalysisError, type Analysis, type Take, type VoiceGoal } from '../types'
import { STEPS } from './steps'

/** Latest take per step key in that session, in STEPS order (null where none). */
export function sessionSlots(takes: readonly Take[], session: string): (Take | null)[] {
  return STEPS.map(
    (st) => takes.filter((t) => t.session === session && t.step === st.key).sort((a, b) => b.id - a.id)[0] ?? null,
  )
}

/** Below this control-take SNR (dB) the room is noisy and SNR dominates the choice (SPEC "Refinement loop (v1.1)"). */
export const NOISY_CONTROL_SNR = 25

/** |boom| + |warmth| + |mud| + |body| deviation from the goal's target, dB. */
const toneExcess = (a: Analysis, goal: VoiceGoal): number => {
  const d = targetDeviations(a.rel, goal)
  return Math.abs(d[1]) + Math.abs(d[2]) + Math.abs(d[3]) + Math.abs(d[4])
}

/**
 * Quiet room: tone excess + max(0, 40 - snr) / 2 (prototype). Noisy room (any control take with SNR < 25): SNR
 * dominates, 0.5 x tone excess + 1.5 x max(0, 40 - snr), so a boomy close take beats a far take buried in the room.
 */
export const controlScore = (a: Analysis, noisy: boolean, goal: VoiceGoal): number => {
  const gap = Math.max(0, 40 - a.snr)
  return noisy ? 0.5 * toneExcess(a, goal) + 1.5 * gap : toneExcess(a, goal) + gap / 2
}

/**
 * The control take (first 3 slots) with the lowest controlScore: |boom|+|warmth|+|mud|+|body| deviation plus
 * max(0, 40 - snr) / 2; when any control take has SNR < 25, 0.5 x that deviation + 1.5 x max(0, 40 - snr).
 * Needs at least 2 analyzed control takes. Deviations are measured against the goal's target curve.
 */
export function bestControl(
  sessionTakes: readonly (Take | null)[],
  goal: VoiceGoal = DEFAULT_GOAL,
): { dist: string; cm: number; take: Take } | null {
  const ts: { a: Analysis; dist: string; cm: number; take: Take }[] = []
  sessionTakes.slice(0, 3).forEach((t, i) => {
    const st = STEPS[i]
    if (!t || isAnalysisError(t.analysis) || st.dist === null || st.cm === null) return
    ts.push({ a: t.analysis, dist: st.dist, cm: st.cm, take: t })
  })
  if (ts.length < 2) return null
  const noisy = ts.some((t) => t.a.snr < NOISY_CONTROL_SNR)
  ts.sort((x, y) => controlScore(x.a, noisy, goal) - controlScore(y.a, noisy, goal))
  return { dist: ts[0].dist, cm: ts[0].cm, take: ts[0].take }
}
