// Is a raw take good enough to tune on? (SPEC "Tune from a recording — screen", step 1). Framework-free. Uses the
// tuner's own frame split (prepareTake), so a take that passes here is one the tuner can measure.
import { failureId, quickStats } from '../../audio/quickStats'
import { prepareTake, TUNE_SAMPLE_RATE } from '../tune/measure'
import { MIN_WAV_SEC } from './wavDecode'

/** Seconds of speech frames a take needs (about a quarter of the ~22 s of talking). */
export const MIN_SPEECH_SEC = 5

/**
 * Why a take cannot be used, most important first:
 * clipped (the recording itself hits full scale), quietBroken (sound during the 3 s quiet lead), tooShort,
 * silent / tooQuiet / noisyPause (the web check's reasons, src/audio/quickStats.ts), notEnoughSpeech.
 */
export type TakeProblem = 'clipped' | 'quietBroken' | 'tooShort' | 'silent' | 'tooQuiet' | 'noisyPause' | 'notEnoughSpeech'

export function checkTake(take: Float32Array, sampleRate = TUNE_SAMPLE_RATE): TakeProblem | null {
  if (take.length < MIN_WAV_SEC * sampleRate) return 'tooShort'
  const id = failureId(quickStats(take, sampleRate))
  const mask = prepareTake(take, sampleRate)
  if (!mask) return id === 'tooShort' ? 'notEnoughSpeech' : id
  if (mask.analysis.clip > 0) return 'clipped'
  // analysed, but the voice is so quiet that no make-up gain can help (a noisy room is the tuner's job)
  if (id === 'silent' || id === 'tooQuiet') return id
  if (mask.analysis.quietBroken) return 'quietBroken'
  if ((mask.speech.length * mask.win) / sampleRate < MIN_SPEECH_SEC) return 'notEnoughSpeech'
  return null
}
