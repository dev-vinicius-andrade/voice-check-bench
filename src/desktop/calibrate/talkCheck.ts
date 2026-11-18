// The talk phase's checks of the live noise calibration (SPEC "Calibrate noise live"). Pure. Live there is no ungated
// render to compare with, as the tuner has (../tune/measure.ts cutOf): the reference is the raw mic, aligned sample by
// sample with what the effects made of it. The constants and the verdicts are the tuner's.
import { FLOOR_DB } from '../../audio/analyze'
import { median, pct } from '../../audio/dsp'
import {
  CUT_DB,
  CUT_EVENT_DB,
  CUT_FRAME_SEC,
  CUT_FULL_DB,
  CUT_MIN_FRAMES,
  CUT_PAD_SEC,
  CUT_VOICE_DB,
  fineLevels,
  MIN_PAUSE_FRAMES,
  PAUSE_GUARD,
  PAUSE_MARGIN_DB,
  PUMP_AUDIBLE_SNR_DB,
  SILENT_DB,
} from '../tune/measure'
import { cutsSpeech, pumps } from '../tune/score'
import { CAL_FRAME_SEC, speechFrame, type CalFrameLevels } from './levels'

/** What one stretch of talking says about the words and the noise between them. */
export interface TalkCheck {
  /** Seconds of speech frames heard. */
  speechSec: number
  /** Median level of the speech frames, processed and raw, dBFS. */
  speechDb: number
  rawSpeechDb: number
  /** The effects' steady gain on clear speech (median over its loud half), dB. */
  gainDb: number
  /** Speech cut (the tuner's cutSpeech / cutEvents): share of the voice frames by depth, and cuts per 10 s; `cuts`
   * also when the voice came out silent (SILENT_DB). */
  cutShare: number
  cutEvents: number
  cuts: boolean
  /** Median processed level of the pauses between words, dBFS (NaN when there were too few). */
  pausesDb: number
  /** P10 of the quietest quarter's raw sample peaks: the quiet syllables a gate must open on, dBFS. */
  quietPeakDb: number
  /** How far the room moves between the words and the long pauses while it is audible (the tuner's pumpDb), dB. */
  pumpDb: number
  pumps: boolean
}

const pow = (db: number): number => 10 ** (db / 10)

/**
 * Checks a stretch of talking. `frames` are its 50 ms frames (./levels.ts), `raw` / `proc` its samples, `roomDb` the
 * raw room from the quiet phase, `longPausesDb` the processed pauses measured there after the changes.
 * - Speech: frames TALK_OVER_ROOM_DB over the room (speechFrame). Cut check: CUT_FRAME_SEC frames over the speech and CUT_PAD_SEC
 *   around it (word starts and tails). The raw frame carries voice when it is CUT_VOICE_DB over the room; its voice is
 *   the raw power minus the room's (at most 1.3 dB less), so a remover that only took the room under a quiet syllable
 *   does not read as cutting it. Expected gain: the median of processed − voice over the loud half of the speech. A
 *   voice frame sitting deeper than CUT_DB under that is cut by its depth (CUT_FULL_DB counts in full), CUT_MIN_FRAMES
 *   in a row deeper than CUT_EVENT_DB are one cut event; the verdict is the tuner's (cutsSpeech).
 * - Pauses between words: frames within PAUSE_MARGIN_DB of the room and PAUSE_GUARD frames away from speech.
 * - Pumping: the room as it comes through while the effects let the voice through — with a remover working
 *   (`removerWorks`), the processed pauses between words; else the raw room plus the steady gain (a gate open on a
 *   word lets the room through with it) — against `longPausesDb`, counted only while it is audible (less than
 *   PUMP_AUDIBLE_SNR_DB under the voice); the verdict is the tuner's (pumps).
 */
export function talkCheck(frames: readonly CalFrameLevels[], raw: Float32Array, proc: Float32Array, sampleRate: number, roomDb: number, longPausesDb: number, removerWorks: boolean): TalkCheck {
  const isSpeech = frames.map((f) => speechFrame(f, roomDb))
  const speech = frames.flatMap((_, k) => (isSpeech[k] ? [k] : []))
  const near = (k: number, d: number): boolean => {
    for (let j = Math.max(0, k - d); j <= Math.min(frames.length - 1, k + d); j++) if (isSpeech[j]) return true
    return false
  }
  const pause = frames.flatMap((f, k) => (!isSpeech[k] && f.rawDb <= roomDb + PAUSE_MARGIN_DB && !near(k, PAUSE_GUARD) ? [k] : []))
  const speechDb = speech.length ? median(speech.map((k) => frames[k].procDb)) : NaN
  const rawSpeechDb = speech.length ? median(speech.map((k) => frames[k].rawDb)) : NaN
  const pausesDb = pause.length >= MIN_PAUSE_FRAMES ? median(pause.map((k) => frames[k].procDb)) : NaN

  const levels = speech.map((k) => frames[k].rawDb)
  const q25 = pct(levels, 0.25)
  const quiet = speech.filter((k) => frames[k].rawDb <= q25)
  const quietPeakDb = pct(quiet.map((k) => frames[k].rawPeakDb), 0.1)

  // cut check on 10 ms frames
  const r = fineLevels(raw, sampleRate)
  const p = fineLevels(proc, sampleRate)
  const per = Math.round(CAL_FRAME_SEC / CUT_FRAME_SEC)
  const n = Math.min(r.length, p.length, frames.length * per)
  const room = pow(roomDb)
  const voiceDb = (i: number): number => (r[i] >= roomDb + CUT_VOICE_DB ? 10 * Math.log10(pow(r[i]) - room) : NaN)
  const loud: number[] = []
  const speechFine = speech.flatMap((k) => Array.from({ length: per }, (_, j) => k * per + j)).filter((i) => i < n)
  const loudFrom = median(speechFine.map((i) => r[i]))
  for (const i of speechFine) if (r[i] >= loudFrom && Number.isFinite(voiceDb(i))) loud.push(p[i] - voiceDb(i))
  const gainDb = loud.length ? median(loud) : 0
  const pad = Math.round(CUT_PAD_SEC / CAL_FRAME_SEC)
  let voice = 0
  let cut = 0
  let events = 0
  let run = 0
  let fine = 0
  for (let k = 0; k < frames.length; k++) {
    if (!near(k, pad)) {
      run = 0
      continue
    }
    for (let j = 0; j < per && k * per + j < n; j++) {
      const i = k * per + j
      fine++
      const v = voiceDb(i)
      if (!Number.isFinite(v)) {
        run = 0
        continue
      }
      voice++
      const depth = v + gainDb - Math.max(FLOOR_DB, p[i])
      if (depth > CUT_DB) cut += Math.min(1, (depth - CUT_DB) / (CUT_FULL_DB - CUT_DB))
      if (depth > CUT_EVENT_DB) {
        if (++run === CUT_MIN_FRAMES) events++
      } else run = 0
    }
  }
  const cutShare = voice ? cut / voice : 0
  const cutEvents = fine ? (events / (fine * CUT_FRAME_SEC)) * 10 : 0

  const roomOpen = removerWorks ? pausesDb : roomDb + gainDb
  const audible = Number.isFinite(roomOpen) && Number.isFinite(speechDb) && speechDb - roomOpen < PUMP_AUDIBLE_SNR_DB
  const pumpDb = audible && Number.isFinite(longPausesDb) ? Math.max(0, roomOpen - longPausesDb) : 0
  return {
    speechSec: speech.length * CAL_FRAME_SEC,
    speechDb,
    rawSpeechDb,
    gainDb,
    cutShare,
    cutEvents,
    // a voice taken out altogether has no steady gain to compare with (the tuner's `silent` render)
    cuts: !(speechDb > SILENT_DB) || cutsSpeech({ cutShare, cutEvents }),
    pausesDb,
    quietPeakDb,
    pumpDb,
    pumps: pumps({ pumpDb }),
  }
}
