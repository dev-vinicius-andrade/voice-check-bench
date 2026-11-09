// Inputs for the plain-language results of take A: clarity score, ratings and the next actions with their context.
import { useMemo } from 'react'
import { nextActions, type ActionContext } from '../../plain/actions'
import { plainRatings } from '../../plain/ratings'
import { clarityScore } from '../../plain/score'
import type { Action, ClarityScore, Rating } from '../../plain/types'
import { STEPS } from '../../session/steps'
import { useBestControl, useMicProfile, useSuggestion } from '../../store/hooks'
import { isAnalysisError, type Analysis, type Take } from '../../types'

export interface PlainResults {
  score: ClarityScore
  ratings: Rating[]
  actions: Action[]
  ctx: ActionContext
  /** Score of the best raw take of the same session when A is the processed take (before vs after). */
  before: ClarityScore | null
}

/** Distance of a guided control take ("8 cm"); null for free and processed takes. */
export const stepDist = (A: Take): string | null => STEPS.find((s) => s.key === A.step)?.dist ?? null

export function usePlainResults(A: Take, a: Analysis): PlainResults {
  const profile = useMicProfile()
  const best = useBestControl(A.session)
  const hasSuggestion = useSuggestion() !== null
  const mic = A.mic ?? profile
  const bestDist = A.session === 'free' ? null : (best?.dist ?? null)
  return useMemo(() => {
    const ctx: ActionContext = { mic, bestDist, currentDist: stepDist(A), hasSuggestion }
    const raw = A.step === 'fx' && best && !isAnalysisError(best.take.analysis) ? best.take.analysis : null
    return { score: clarityScore(a), ratings: plainRatings(a), actions: nextActions(a, ctx), ctx, before: raw ? clarityScore(raw) : null }
  }, [A, a, mic, bestDist, hasSuggestion, best])
}
