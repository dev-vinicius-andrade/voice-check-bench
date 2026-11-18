// Is a raw take good enough to tune on? (SPEC "Tune from a recording — screen", step 1). Framework-free. Uses the
// tuner's own frame split (prepareTake), so a take that passes here is one the tuner can measure.
import { failureId, quickStats } from '../../audio/quickStats'
import { QUIET_SEC } from '../../audio/reference'
import { prepareTake, TUNE_SAMPLE_RATE } from '../tune/measure'
import { MIN_WAV_SEC } from './wavDecode'

/** Seconds of speech frames a take needs (about a quarter of the ~22 s of talking). */
export const MIN_SPEECH_SEC = 5

/**
 * The quiet lead counts as talked over only when it gets this close to the voice, dB: its loudest tenth within this
 * much of the median speech level. A loud or uneven room (fan, keyboard, street) stays well below the voice and is the
 * tuner's job, not a reason to record again; analyze()'s own quietBroken flag also fires on such rooms.
 */
export const QUIET_TALK_DB = 8

/** True when someone talked during the quiet lead: its 90th-percentile 50 ms level is within QUIET_TALK_DB of speech. */
export function quietTalkedOver(take: Float32Array, sampleRate: number, speechMedDb: number): boolean {
  const win = Math.round(0.05 * sampleRate)
  // the window analyze() reads the room from: 0.6 s .. QUIET_SEC − 0.3 s
  const levels: number[] = []
  for (let f = Math.round(0.6 / 0.05); f < Math.round((QUIET_SEC - 0.3) / 0.05); f++) {
    let sum = 0
    for (let i = f * win; i < (f + 1) * win; i++) sum += (take[i] ?? 0) ** 2
    levels.push(10 * Math.log10(Math.max(1e-12, sum / win)))
  }
  if (levels.length === 0) return false
  levels.sort((a, b) => a - b)
  const p90 = levels[Math.min(levels.length - 1, Math.floor(levels.length * 0.9))] ?? -200
  return p90 > speechMedDb - QUIET_TALK_DB
}

/**
 * Why a take cannot be used, most important first:
 * clipped (the recording itself hits full scale), quietBroken (talking during the 3 s quiet lead), tooShort,
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
  if (mask.analysis.quietBroken && quietTalkedOver(take, sampleRate, mask.analysis.speechMed)) return 'quietBroken'
  if ((mask.speech.length * mask.win) / sampleRate < MIN_SPEECH_SEC) return 'notEnoughSpeech'
  return null
}
