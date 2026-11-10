// Distance check for processed takes (SPEC "Refinement loop (v1.1)"). Pure.
import type { Msg } from '../plain/types'
import type { StepKey } from '../types'
import { takeDist } from './steps'

/** A processed take recorded at another distance than the one its settings were made for. */
export interface DistanceMismatch {
  /** Distance the settings were made for: record the next processed take here. */
  expected: string
  /** Distance the processed take was recorded at. */
  actual: string
  /** "This take was recorded at {{actual}}, but the settings were made for {{dist}}. Record again at {{dist}} …" */
  msg: Msg
}

type GuidedTake = { step: StepKey | null; name: string }

/** `{ dist }` (AppliedSettings, a Suggestion), a guided take (the suggestion base), or a distance string. */
export type DistanceRef = { dist: string } | GuidedTake | string | null | undefined

const normalize = (d: string): string => d.trim().toLowerCase().replace(/\s+/g, ' ')

/** The distance a reference stands for; null when unknown (free take, empty string). */
export function refDistance(ref: DistanceRef): string | null {
  if (ref == null) return null
  if (typeof ref === 'string') return ref.trim() || null
  if ('dist' in ref) return ref.dist.trim() || null
  return takeDist(ref)
}

/**
 * Mismatch between the processed take's distance and the reference's (applied settings or the suggestion base).
 * Null when they match or either distance is unknown: such a take can still be judged.
 */
export function distanceMismatch(fxTake: GuidedTake, ref: DistanceRef): DistanceMismatch | null {
  const actual = takeDist(fxTake)
  const expected = refDistance(ref)
  if (!actual || !expected || normalize(actual) === normalize(expected)) return null
  return { expected, actual, msg: { key: 'plain.refine.wrongDistance', params: { dist: expected, actual } } }
}
