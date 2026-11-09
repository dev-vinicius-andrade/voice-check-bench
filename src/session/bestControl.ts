// Best control take selection ported 1:1 from the prototype (docs/prototype/voice-check.html). Pure.
import { targetDeviations } from '../audio/reference'
import { DEFAULT_GOAL, isAnalysisError, type Analysis, type Take, type VoiceGoal } from '../types'
import { STEPS } from './steps'

/** Latest take per step key in that session, in STEPS order (null where none). */
export function sessionSlots(takes: readonly Take[], session: string): (Take | null)[] {
  return STEPS.map(
    (st) => takes.filter((t) => t.session === session && t.step === st.key).sort((a, b) => b.id - a.id)[0] ?? null,
  )
}

/** Noisy room (any control take with SNR < 25): the SNR penalty counts double. */
const score = (a: Analysis, noisy: boolean, goal: VoiceGoal): number => {
  const d = targetDeviations(a.rel, goal)
  const snrPenalty = Math.max(0, 40 - a.snr) / (noisy ? 1 : 2)
  return Math.abs(d[1]) + Math.abs(d[2]) + Math.abs(d[3]) + Math.abs(d[4]) + snrPenalty
}

/**
 * The control take (first 3 slots) with the lowest |boom|+|warmth|+|mud|+|body| deviation plus
 * an SNR penalty: max(0, 40 - snr) / 2, or max(0, 40 - snr) when any control take has SNR < 25.
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
  const noisy = ts.some((t) => t.a.snr < 25)
  ts.sort((x, y) => score(x.a, noisy, goal) - score(y.a, noisy, goal))
  return { dist: ts[0].dist, cm: ts[0].cm, take: ts[0].take }
}
