// On-screen distance and copy for a guided step (shared by the setup list, the step screen and the nav).
import { fmtCm } from '../../i18n/format'
import { distanceCm } from '../../plain/distances'
import { stepText } from '../../session/steps'
import type { StepPart, Translate } from '../../session/steps'
import type { StepDef } from '../../types'

/** The step's own distance, or the best distance for the effects take; null when unknown. */
export const stepCm = (st: Pick<StepDef, 'cm'>, fxDist: string): number | null => st.cm ?? distanceCm(fxDist)

/** "8 cm" in the active locale (plus inches for en-US); falls back to the raw label. */
export function stepDist(st: Pick<StepDef, 'cm'>, fxDist: string): string {
  const cm = stepCm(st, fxDist)
  return cm === null ? fxDist : fmtCm(cm)
}

/** Translated kind/title/heading/lead for a step, with its formatted distance filled in. */
export const stepCopy = (st: StepDef, t: Translate, fxDist: string): Record<StepPart, string> =>
  stepText(st, t, stepDist(st, fxDist))
