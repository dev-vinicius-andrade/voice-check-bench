// Is a raw take good enough to tune on? (SPEC "Tune from a recording — screen", step 1). Framework-free. Uses the
// tuner's own frame split (prepareTake), so a take that passes here is one the tuner can measure.
import { failureId, quickStats } from '../../audio/quickStats'
import { QUIET_SEC } from '../../audio/reference'
import { prepareTake, TUNE_SAMPLE_RATE } from '../tune/measure'
import { MIN_WAV_SEC } from './wavDecode'

/** Seconds of speech frames a take needs (about a quarter of the ~22 s of talking). */
export const MIN_SPEECH_SEC = 5

/**
 * The quiet lead counts as talked over only when it gets this close to the voice, dB: 50 ms frames within this much
 * of the median speech level. A loud or uneven room (fan, keyboard, street) stays well below the voice and is the
 * tuner's job, not a reason to record again; analyze()'s own quietBroken flag also fires on such rooms.
 */
export const QUIET_TALK_DB = 8
/** …for this long in all, s: a click, a chair or a breath is shorter than a word. */
export const QUIET_TALK_SEC = 0.4
/**
 * …and the lead does not sound like a steady room: its level moves this much (90th over 10th percentile), dB, or it
 * sits at the voice's own level (median within QUIET_VOICE_DB of the speech: talking all through it). A steady room
 * that close to the voice (a hot mic gain, a soft voice: user-reported with the room 11 dB under the voice) is a
 * noisy room, not talking.
 */
export const QUIET_UNSTEADY_DB = 6
export const QUIET_VOICE_DB = 3

/** True when someone talked during the quiet lead (QUIET_TALK_DB, QUIET_TALK_SEC, QUIET_UNSTEADY_DB / QUIET_VOICE_DB). */
export function quietTalkedOver(take: Float32Array, sampleRate: number, speechMedDb: number): boolean {
  const frameSec = 0.05
  const win = Math.round(frameSec * sampleRate)
  // the window analyze() reads the room from: 0.6 s .. QUIET_SEC − 0.3 s
  const levels: number[] = []
  for (let f = Math.round(0.6 / frameSec); f < Math.round((QUIET_SEC - 0.3) / frameSec); f++) {
    let sum = 0
    for (let i = f * win; i < (f + 1) * win; i++) sum += (take[i] ?? 0) ** 2
    levels.push(10 * Math.log10(Math.max(1e-12, sum / win)))
  }
  if (levels.length === 0) return false
  levels.sort((x, y) => x - y)
  const at = (q: number): number => levels[Math.min(levels.length - 1, Math.floor(levels.length * q))] ?? -200
  const loud = levels.filter((l) => l > speechMedDb - QUIET_TALK_DB).length
  if (loud * frameSec < QUIET_TALK_SEC) return false
  return at(0.9) - at(0.1) > QUIET_UNSTEADY_DB || at(0.5) > speechMedDb - QUIET_VOICE_DB
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
