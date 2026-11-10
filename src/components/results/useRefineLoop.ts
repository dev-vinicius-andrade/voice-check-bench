// Closed loop (v1.1): every processed take of A's session recorded with applied settings, evaluated against the raw
// reference, plus the refinement for A when it did not improve.
import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { evaluateProcessed, refine } from '../../plain/refine'
import type { DistanceMismatch } from '../../session/distance'
import { useBench } from '../../store/benchStore'
import { isAnalysisError, type AppliedSettings, type Refinement, type Take, type VoiceGoal } from '../../types'
import { rawReference } from './roomNoise'

export interface Attempt {
  id: number
  /** 1-based position in the session. */
  n: number
  rawScore: number
  fxScore: number
  improved: boolean
  /** Set when recorded at another distance than the settings were made for: not used to judge them. */
  mismatch: DistanceMismatch | null
}

export interface RefineLoop {
  attempts: Attempt[]
  /** A's evaluation. */
  current: Attempt
  applied: AppliedSettings
  /** Next settings when A did not improve and the distance matched. */
  refinement: Refinement | null
}

/** Pure: null unless A is a processed take with applied settings and a raw reference. */
export function refineLoop(takes: readonly Take[], A: Take, session: string, fxDist: string | null, goal: VoiceGoal): RefineLoop | null {
  if (A.step !== 'fx' || !A.applied || isAnalysisError(A.analysis)) return null
  const fxTakes = takes.filter((t) => t.session === A.session && t.step === 'fx' && t.applied && !isAnalysisError(t.analysis)).sort((x, y) => x.id - y.id)
  const attempts: Attempt[] = []
  for (const t of fxTakes) {
    const raw = rawReference(takes, t, session, fxDist)
    if (!raw || !t.applied || isAnalysisError(t.analysis)) continue
    const e = evaluateProcessed(raw, t, t.applied, goal)
    if (!e) continue
    attempts.push({ id: t.id, n: attempts.length + 1, rawScore: e.rawScore, fxScore: e.fxScore, improved: e.improved, mismatch: e.mismatch })
  }
  const current = attempts.find((x) => x.id === A.id)
  const raw = rawReference(takes, A, session, fxDist)
  if (!current || !raw) return null
  const refinement = current.improved || current.mismatch ? null : refine(raw, A, A.applied, goal)
  return { attempts, current, applied: A.applied, refinement }
}

export function useRefineLoop(A: Take): RefineLoop | null {
  const st = useBench(useShallow((s) => ({ takes: s.takes, session: s.session, fxDist: s.fxDist, goal: s.goal })))
  return useMemo(() => refineLoop(st.takes, A, st.session, st.fxDist, st.goal), [st, A])
}
