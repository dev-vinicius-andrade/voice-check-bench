// Live window metrics (SPEC "Live tuning (v1.3)"): level, peaks, pause noise, dead silence and tone of the raw mic and
// the Wave Link output over the last LIVE_WINDOW_SEC. Pure. Frames, talk/pause classification and talk-frame spectra
// come from ./frames (shared with the running segments); tone is judged by targetDeviations against the person's goal.
import { digitalSilence, FLOOR_DB } from '../audio/analyze'
import { adb, median } from '../audio/dsp'
import { BANDS, targetDeviations } from '../audio/reference'
import type { VoiceGoal } from '../types'
import {
  addFramePower,
  bandEnergies,
  FRAME_SEC,
  liveFrames,
  MIN_PAUSE_SEC,
  MIN_TALK_SEC,
  relBands,
  specScratch,
  TONE_MAX_FRAMES,
  type Frames,
  type LiveFrames,
} from './frames'
import type { LiveMetrics, LiveSide } from './types'

export {
  classifyFrames,
  FLOOR_PCT,
  FRAME_SEC,
  MIN_PAUSE_SEC,
  MIN_TALK_FRAMES,
  MIN_TALK_SEC,
  TALK_MIN_DB,
  TONE_FFT,
  TONE_MAX_FRAMES,
} from './frames'

/** What computeLiveMetrics measures; the session adds lag, sync and hints. */
export type LiveWindowMetrics = Pick<LiveMetrics, 'talkSec' | 'raw' | 'fx'>

const pick = (levels: Float64Array, mask: Uint8Array): number[] => {
  const out: number[] = []
  for (let f = 0; f < levels.length; f++) if (mask[f]) out.push(levels[f])
  return out
}

/** Band energies (dB) of the averaged talk-frame power spectrum (≤ TONE_MAX_FRAMES, evenly spread), relative to band 4. */
function talkRel(fr: LiveFrames, x: Float32Array): number[] {
  const idx: number[] = []
  for (let f = 0; f < fr.nF; f++) if (fr.talk[f]) idx.push(f)
  const use = idx.length > TONE_MAX_FRAMES ? Array.from({ length: TONE_MAX_FRAMES }, (_, i) => idx[Math.floor((i * idx.length) / TONE_MAX_FRAMES)]) : idx
  const sc = specScratch(fr.win)
  const spec = new Float64Array(sc.n / 2 + 1)
  for (const f of use) addFramePower(x, fr.off + f * fr.win, sc, spec)
  return relBands(bandEnergies(spec, fr.sampleRate, sc.n))
}

function side(fr: LiveFrames, x: Float32Array, frames: Frames, goal: VoiceGoal): LiveSide {
  const pauses = pick(frames.levels, fr.pause)
  const talkSec = fr.talkFrames * FRAME_SEC
  return {
    speechDb: median(pick(frames.levels, fr.talk)),
    peakDb: Math.max(FLOOR_DB, adb(frames.peak)),
    clipFrames: frames.clipFrames,
    pauseDb: pauses.length * FRAME_SEC >= MIN_PAUSE_SEC - 1e-9 ? median(pauses) : NaN,
    deadSilence: digitalSilence(x, fr.sampleRate).zeroRatio,
    tone: talkSec >= MIN_TALK_SEC ? targetDeviations(talkRel(fr, x), goal) : BANDS.map(() => NaN),
  }
}

/** Window metrics of frames already cut by liveFrames(). */
export function metricsOfFrames(fr: LiveFrames, goal: VoiceGoal): LiveWindowMetrics {
  return {
    talkSec: fr.talkFrames * FRAME_SEC,
    raw: fr.raw && fr.rawFrames ? side(fr, fr.raw, fr.rawFrames, goal) : null,
    fx: side(fr, fr.fx, fr.fxFrames, goal),
  }
}

/**
 * Metrics of one window. rawWin and fxWin end at the same instant (same AudioContext frame); rawWin may be longer so
 * that, shifted by the lag, it still covers the whole fx window. See liveFrames() for the pairing and classification.
 */
export function computeLiveMetrics(rawWin: Float32Array | null, fxWin: Float32Array, sampleRate: number, lagMs: number | null, goal: VoiceGoal): LiveWindowMetrics {
  return metricsOfFrames(liveFrames(rawWin, fxWin, sampleRate, lagMs), goal)
}
