// Inputs for the plain-language results of take A: clarity score, ratings and the next actions with their context.
import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { nextActions, type ActionContext } from '../../plain/actions'
import { plainRatings } from '../../plain/ratings'
import { clarityScore } from '../../plain/score'
import type { Action, ClarityScore, Rating } from '../../plain/types'
import { STEPS } from '../../session/steps'
import { useBench } from '../../store/benchStore'
import { useBestControl, useMicProfile, useSuggestion } from '../../store/hooks'
import type { Analysis, Take } from '../../types'
import { rawReference } from './roomNoise'

export interface PlainResults {
  score: ClarityScore
  ratings: Rating[]
  actions: Action[]
  ctx: ActionContext
  /** Score of the session's raw reference when A is the processed take (before vs after). */
  before: ClarityScore | null
  /** The raw reference's analysis (null unless A is the processed take): score, ratings and actions compare against it. */
  raw: Analysis | null
}

/** Distance of a guided control take ("8 cm"); null for free and processed takes. */
export const stepDist = (A: Take): string | null => STEPS.find((s) => s.key === A.step)?.dist ?? null

export function usePlainResults(A: Take, a: Analysis): PlainResults {
  const profile = useMicProfile()
  const best = useBestControl(A.session)
  const hasSuggestion = useSuggestion() !== null
  const inputs = useBench(useShallow((s) => ({ takes: s.takes, session: s.session, fxDist: s.fxDist })))
  const mic = A.mic ?? profile
  const bestDist = A.session === 'free' ? null : (best?.dist ?? null)
  return useMemo(() => {
    // the same raw reference as the before/after card: raw control at the processed distance, else the best control
    const raw = A.step === 'fx' ? (rawReference(inputs.takes, A, inputs.session, inputs.fxDist)?.analysis ?? null) : null
    const ctx: ActionContext = { mic, bestDist, currentDist: stepDist(A), hasSuggestion, raw }
    return {
      score: clarityScore(a, { raw }),
      ratings: plainRatings(a, { raw }),
      actions: nextActions(a, ctx),
      ctx,
      before: raw ? clarityScore(raw) : null,
      raw,
    }
  }, [A, a, mic, bestDist, hasSuggestion, inputs])
}
