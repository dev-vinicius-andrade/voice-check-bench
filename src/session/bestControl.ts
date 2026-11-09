// Best control take selection ported 1:1 from the prototype (docs/prototype/voice-check.html). Pure.
import { deviations } from '../audio/reference'
import { isAnalysisError, type Analysis, type Take } from '../types'
import { STEPS } from './steps'

/** Latest take per step key in that session, in STEPS order (null where none). */
export function sessionSlots(takes: readonly Take[], session: string): (Take | null)[] {
  return STEPS.map(
    (st) => takes.filter((t) => t.session === session && t.step === st.key).sort((a, b) => b.id - a.id)[0] ?? null,
  )
}

const score = (a: Analysis): number => {
  const d = deviations(a.rel)
  return Math.abs(d[1]) + Math.abs(d[2]) + Math.abs(d[3]) + Math.abs(d[4]) + Math.max(0, 40 - a.snr) / 2
}

/**
 * The control take (first 3 slots) with the lowest |boom|+|warmth|+|mud|+|body| deviation plus
 * an SNR penalty. Needs at least 2 analyzed control takes.
 */
export function bestControl(sessionTakes: readonly (Take | null)[]): { dist: string; cm: number; take: Take } | null {
  const ts: { a: Analysis; dist: string; cm: number; take: Take }[] = []
  sessionTakes.slice(0, 3).forEach((t, i) => {
    const st = STEPS[i]
    if (!t || isAnalysisError(t.analysis) || st.dist === null || st.cm === null) return
    ts.push({ a: t.analysis, dist: st.dist, cm: st.cm, take: t })
  })
  if (ts.length < 2) return null
  ts.sort((x, y) => score(x.a) - score(y.a))
  return { dist: ts[0].dist, cm: ts[0].cm, take: ts[0].take }
}
