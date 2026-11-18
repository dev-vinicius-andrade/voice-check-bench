import { useMemo } from 'react'
import { noiseOnly, noiseStretches, voiceNoiseOf, type VoiceNoise } from '../../../desktop/spectrum/voiceNoise'
import type { NoisePair } from './useAbPlayer'

export interface TakeVoiceNoise {
  /** Voice and noise of the take and of the render After plays; null when the take has no noise stretches. */
  before: VoiceNoise | null
  after: VoiceNoise | null
  /** The noise-only audio of each side; null when there is nothing to play. */
  noise: NoisePair | null
}

/**
 * Voice and noise of the result step (SPEC "Tune from a recording — voice and noise"): the stretches where the person
 * is not talking, found once per take; the take's measure once per take, the render's again for each new render.
 */
export function useVoiceNoise(take: Float32Array, processed: Float32Array): TakeVoiceNoise {
  const stretches = useMemo(() => noiseStretches(take), [take])
  const has = stretches.length > 0
  const before = useMemo(() => (has ? voiceNoiseOf(take, take, stretches) : null), [has, take, stretches])
  const after = useMemo(() => (has ? voiceNoiseOf(processed, take, stretches) : null), [has, processed, take, stretches])
  const noiseBefore = useMemo(() => (has ? noiseOnly(take, stretches) : null), [has, take, stretches])
  const noiseAfter = useMemo(() => (has ? noiseOnly(processed, stretches) : null), [has, processed, stretches])
  const noise = useMemo(
    () => (noiseBefore && noiseAfter && noiseBefore.length > 0 && noiseAfter.length > 0 ? { before: noiseBefore, after: noiseAfter } : null),
    [noiseBefore, noiseAfter],
  )
  return { before, after, noise }
}
