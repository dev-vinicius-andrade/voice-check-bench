// Live window metrics (SPEC "Live tuning (v1.3)"): level, peaks, pause noise, dead silence and tone of the raw mic and
// the Wave Link output over the last LIVE_WINDOW_SEC. Pure. Mirrors analyze(): 50 ms frames floored at FLOOR_DB, talk =
// frames clearly above the noise floor (SPEECH_MARGINS tried in order, never below -70 dBFS), band energies of the
// talk frames relative to the 640–1250 Hz band, judged by targetDeviations against the person's goal.
import { digitalSilence, FLOOR_DB, SPEECH_MARGINS } from '../audio/analyze'
import { adb, db, fft, hann, median, pct } from '../audio/dsp'
import { PEAK_WARN_DB } from '../audio/diagnose'
import { BANDS, targetDeviations } from '../audio/reference'
import type { VoiceGoal } from '../types'
import type { LiveMetrics, LiveSide } from './types'

/** Frame length, seconds. */
export const FRAME_SEC = 0.05
/** The noise floor of the window is this percentile of its frame levels. */
export const FLOOR_PCT = 0.2
/** A frame must also be louder than this to count as talk, dBFS (as analyze). */
export const TALK_MIN_DB = -70
/** Talk frames wanted before a smaller margin is tried (1 s). */
export const MIN_TALK_FRAMES = 20
/** Below this much talk, tone is not measured (NaN), seconds. */
export const MIN_TALK_SEC = 1
/** Pause frames sit within the smallest speech margin of the floor; pauseDb needs this much of them, seconds. */
export const MIN_PAUSE_SEC = 0.3
/** Largest FFT for the talk-frame spectrum, and the most talk frames it averages (evenly spread). */
export const TONE_FFT = 2048
export const TONE_MAX_FRAMES = 24

/** What computeLiveMetrics measures; the session adds lag, sync and hints. */
export type LiveWindowMetrics = Pick<LiveMetrics, 'talkSec' | 'raw' | 'fx'>

const CLIP_AMP = 10 ** (PEAK_WARN_DB / 20)
const PAUSE_MARGIN = SPEECH_MARGINS[SPEECH_MARGINS.length - 1]

interface Frames {
  levels: Float64Array
  /** Frames whose peak reached PEAK_WARN_DB. */
  clipFrames: number
  peak: number
}

function frameStats(x: Float32Array, win: number, nF: number): Frames {
  const levels = new Float64Array(nF)
  let clipFrames = 0
  let peak = 0
  for (let f = 0; f < nF; f++) {
    let s = 0
    let fp = 0
    const end = (f + 1) * win
    for (let i = f * win; i < end; i++) {
      const v = x[i]
      s += v * v
      // Math.max/abs instead of a branch: noise makes the sign unpredictable (≈ 6× faster)
      fp = Math.max(fp, Math.abs(v))
    }
    levels[f] = Math.max(FLOOR_DB, adb(Math.sqrt(s / win)))
    if (fp >= CLIP_AMP) clipFrames++
    if (fp > peak) peak = fp
  }
  return { levels, clipFrames, peak }
}

/** Talk and pause masks from one input's frame levels. */
const countOn = (a: Uint8Array): number => a.reduce((n, v) => n + v, 0)

export function classifyFrames(levels: Float64Array): { talk: Uint8Array; pause: Uint8Array } {
  const n = levels.length
  const talk = new Uint8Array(n)
  const pause = new Uint8Array(n)
  if (!n) return { talk, pause }
  const floor = Math.max(FLOOR_DB, pct(levels, FLOOR_PCT))
  for (const margin of SPEECH_MARGINS) {
    let c = 0
    for (let f = 0; f < n; f++) {
      talk[f] = levels[f] > floor + margin && levels[f] > TALK_MIN_DB ? 1 : 0
      c += talk[f]
    }
    if (c >= MIN_TALK_FRAMES) break
  }
  for (let f = 0; f < n; f++) pause[f] = !talk[f] && levels[f] < floor + PAUSE_MARGIN ? 1 : 0
  return { talk, pause }
}

const pick = (levels: Float64Array, mask: Uint8Array): number[] => {
  const out: number[] = []
  for (let f = 0; f < levels.length; f++) if (mask[f]) out.push(levels[f])
  return out
}

/** Band energies (dB) of the averaged talk-frame power spectrum, relative to the 640–1250 Hz band (as analyze's `rel`). */
function talkRel(x: Float32Array, win: number, talk: Uint8Array, sampleRate: number): number[] {
  const idx: number[] = []
  for (let f = 0; f < talk.length; f++) if (talk[f]) idx.push(f)
  const n = Math.min(TONE_FFT, 2 ** Math.floor(Math.log2(win)))
  const use = idx.length > TONE_MAX_FRAMES ? Array.from({ length: TONE_MAX_FRAMES }, (_, i) => idx[Math.floor((i * idx.length) / TONE_MAX_FRAMES)]) : idx
  const spec = new Float64Array(n / 2 + 1)
  const pad = Math.floor((win - n) / 2)
  // powerSpec() without its three allocations per frame: same Hann window and FFT, buffers reused
  const w = hann(n)
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  for (const f of use) {
    const s0 = f * win + pad
    for (let i = 0; i < n; i++) re[i] = (x[s0 + i] || 0) * w[i]
    im.fill(0)
    fft(re, im)
    for (let i = 0; i <= n / 2; i++) spec[i] += re[i] * re[i] + im[i] * im[i]
  }
  const binHz = sampleRate / n
  const e = BANDS.map((b) => {
    let s = 0
    for (let i = Math.ceil(b.lo / binHz); i < b.hi / binHz && i < spec.length; i++) s += spec[i]
    return db(s)
  })
  return e.map((v) => v - e[4])
}

function side(x: Float32Array, fr: Frames, talk: Uint8Array, pause: Uint8Array, win: number, sampleRate: number, talkSec: number, goal: VoiceGoal): LiveSide {
  const pauses = pick(fr.levels, pause)
  return {
    speechDb: median(pick(fr.levels, talk)),
    peakDb: Math.max(FLOOR_DB, adb(fr.peak)),
    clipFrames: fr.clipFrames,
    pauseDb: pauses.length * FRAME_SEC >= MIN_PAUSE_SEC - 1e-9 ? median(pauses) : NaN,
    deadSilence: digitalSilence(x, sampleRate).zeroRatio,
    tone: talkSec >= MIN_TALK_SEC ? targetDeviations(talkRel(x, win, talk, sampleRate), goal) : BANDS.map(() => NaN),
  }
}

/**
 * Metrics of one window. rawWin and fxWin end at the same instant (same AudioContext frame); rawWin may be longer so
 * that, shifted by the lag, it still covers the whole fx window. fx sample j is paired with the raw sample lagMs
 * earlier; only the paired stretch is analysed. Talk and pauses are classified on the raw mic (on fx without one) and
 * the same frames are measured on both inputs.
 */
export function computeLiveMetrics(rawWin: Float32Array | null, fxWin: Float32Array, sampleRate: number, lagMs: number | null, goal: VoiceGoal): LiveWindowMetrics {
  const win = Math.max(1, Math.round(FRAME_SEC * sampleRate))
  let fx = fxWin
  let raw: Float32Array | null = null
  if (rawWin) {
    const lag = Math.round(((lagMs ?? 0) * sampleRate) / 1000)
    const offset = rawWin.length - fxWin.length - lag
    const j0 = Math.max(0, -offset)
    const j1 = Math.max(j0, Math.min(fxWin.length, rawWin.length - offset))
    fx = fxWin.subarray(j0, j1)
    raw = rawWin.subarray(j0 + offset, j1 + offset)
  }
  const nF = Math.floor(fx.length / win)
  const fxFrames = frameStats(fx, win, nF)
  const rawFrames = raw ? frameStats(raw, win, nF) : null
  // talk/pause come from the raw mic; a silent raw input (wrong device picked) falls back to the Wave Link output
  let { talk, pause } = classifyFrames((rawFrames ?? fxFrames).levels)
  if (rawFrames && countOn(talk) * FRAME_SEC < MIN_TALK_SEC) {
    const viaFx = classifyFrames(fxFrames.levels)
    if (countOn(viaFx.talk) * FRAME_SEC >= MIN_TALK_SEC) ({ talk, pause } = viaFx)
  }
  let talkFrames = 0
  for (const t of talk) talkFrames += t
  const talkSec = talkFrames * FRAME_SEC
  return {
    talkSec,
    raw: raw && rawFrames ? side(raw, rawFrames, talk, pause, win, sampleRate, talkSec, goal) : null,
    fx: side(fx, fxFrames, talk, pause, win, sampleRate, talkSec, goal),
  }
}
