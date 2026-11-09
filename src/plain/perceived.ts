// What the person hears (VoiceGoal.perceived) fused with what was measured (SPEC "Voice goals (v0.9)"). Pure.
import { targetDeviations } from '../audio/reference'
import { DEFAULT_GOAL, type Analysis, type PerceivedIssue, type VoiceGoal } from '../types'
import type { Msg } from './types'

/** Every perceived issue, in the order the setup screen lists them. */
export const PERCEIVED_ISSUES: readonly PerceivedIssue[] = ['nasal', 'muffled', 'boomy', 'thin', 'harsh', 'sharpS', 'dull']

/** A band this many dB past the target (in the issue's direction) confirms what the person hears. */
export const CONFIRM_DB = 1.5
/** S peaks above this (dBFS, sibP95) confirm sharp S sounds (same threshold as the 'harsh' check). */
const SHARP_S_P95 = -6

export interface FusedIssue {
  issue: PerceivedIssue
  /** True when the measurement agrees with what the person hears. */
  confirmed: boolean
  /** How far the measurement goes in the issue's direction, dB vs the target (positive = agrees); 0 when unknown. */
  delta: number
}

const finite = (v: number): number => (Number.isFinite(v) ? v : 0)

/** Measured excess in the issue's direction (dB vs target) and whether it confirms the issue. */
function measure(issue: PerceivedIssue, d: readonly number[], a: Analysis): { delta: number; confirmed: boolean } {
  const over = (v: number): { delta: number; confirmed: boolean } => ({ delta: finite(v), confirmed: v > CONFIRM_DB })
  switch (issue) {
    case 'nasal': // body or definition above target
      return over(Math.max(finite(d[4]), finite(d[5])))
    case 'muffled': // mud high or presence low
      return over(Math.max(finite(d[3]), -finite(d[6])))
    case 'boomy': // boom / warmth high
      return over(Math.max(finite(d[1]), finite(d[2])))
    case 'thin': // boom + warmth low
      return over(-(finite(d[1]) + finite(d[2])) / 2)
    case 'harsh': // presence high
      return over(finite(d[6]))
    case 'sharpS': {
      // sibilance high, or S peaks over the harsh threshold
      const m = over(finite(d[7]))
      return { delta: m.delta, confirmed: m.confirmed || a.sibP95 > SHARP_S_P95 }
    }
    case 'dull': // sibilance + air low
      return over(-(finite(d[7]) + finite(d[8])) / 2)
  }
}

/** The goal's perceived issues (unknown ones dropped, duplicates once, goal order) with the measurement's verdict. */
export function fusePerceived(a: Analysis, goal: VoiceGoal = DEFAULT_GOAL): FusedIssue[] {
  const seen = new Set<PerceivedIssue>()
  const issues = (goal.perceived ?? []).filter((p) => PERCEIVED_ISSUES.includes(p) && !seen.has(p) && (seen.add(p), true))
  if (!issues.length) return []
  const d = targetDeviations(a.rel, goal)
  return issues.map((issue) => ({ issue, ...measure(issue, d, a) }))
}

/**
 * One note per perceived issue: confirmed ("…and the measurement agrees") or by ear ("We didn't measure this, but you
 * hear it — here's a gentle tweak"). Keys `plain.perceived.<confirmed|byEar>.<issue>`.
 */
export function perceivedNotes(a: Analysis, goal: VoiceGoal = DEFAULT_GOAL): Msg[] {
  return fusePerceived(a, goal).map((f) => ({ key: `plain.perceived.${f.confirmed ? 'confirmed' : 'byEar'}.${f.issue}` }))
}
