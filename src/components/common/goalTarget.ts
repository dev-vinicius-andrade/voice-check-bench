// Voice goal choices and the deviation shift the charts use to draw against the goal's target.
import { STYLE_OFFSETS } from '../../audio/reference'
import type { PerceivedIssue, VoiceStyle } from '../../types'

export const STYLES: readonly VoiceStyle[] = ['natural', 'warm', 'clear', 'bright']
export const PERCEIVED: readonly PerceivedIssue[] = ['nasal', 'muffled', 'boomy', 'thin', 'harsh', 'sharpS', 'dull']

/** Deviations from the reference voice → deviations from the style's target (same as targetDeviations, for precomputed arrays). */
export const toTarget = (dev: readonly number[], style: VoiceStyle): number[] =>
  dev.map((v, i) => v - (STYLE_OFFSETS[style][i] ?? 0))
