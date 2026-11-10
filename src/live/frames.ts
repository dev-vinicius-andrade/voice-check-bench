// Frame-level live analysis (SPEC "Live tuning (v1.3)"), shared by the window metrics (metrics.ts) and the running
// segments (segments.ts). Pure, no browser APIs. Mirrors analyze(): 50 ms frames floored at FLOOR_DB, talk = frames
// clearly above the noise floor (SPEECH_MARGINS tried in order, never below -70 dBFS), band energies of talk frames.
import { FLOOR_DB, SPEECH_MARGINS, ZERO_RUN_SEC } from '../audio/analyze'
import { adb, db, fft, hann, pct } from '../audio/dsp'
import { PEAK_WARN_DB } from '../audio/diagnose'
import { BANDS } from '../audio/reference'

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
/** Largest FFT for the talk-frame spectrum, and the most talk frames a window averages (evenly spread). */
export const TONE_FFT = 2048
export const TONE_MAX_FRAMES = 24

const CLIP_AMP = 10 ** (PEAK_WARN_DB / 20)
const PAUSE_MARGIN = SPEECH_MARGINS[SPEECH_MARGINS.length - 1]

/** Samples per frame at a sample rate. */
export const frameLen = (sampleRate: number): number => Math.max(1, Math.round(FRAME_SEC * sampleRate))

export interface Frames {
  /** Frame RMS, dBFS, floored at FLOOR_DB. */
  levels: Float64Array
  /** 1 where the frame's peak reached PEAK_WARN_DB. */
  clip: Uint8Array
  /** Frames whose peak reached PEAK_WARN_DB. */
  clipFrames: number
  /** Highest absolute sample. */
  peak: number
}

/** Frame f covers x[off + f·win, off + (f+1)·win). */
export function frameStats(x: Float32Array, off: number, win: number, nF: number): Frames {
  const levels = new Float64Array(nF)
  const clip = new Uint8Array(nF)
  let clipFrames = 0
  let peak = 0
  for (let f = 0; f < nF; f++) {
    let s = 0
    let fp = 0
    const start = off + f * win
    const end = start + win
    for (let i = start; i < end; i++) {
      const v = x[i]
      s += v * v
      // Math.max/abs instead of a branch: noise makes the sign unpredictable (≈ 6× faster)
      fp = Math.max(fp, Math.abs(v))
    }
    levels[f] = Math.max(FLOOR_DB, adb(Math.sqrt(s / win)))
    if (fp >= CLIP_AMP) {
      clip[f] = 1
      clipFrames++
    }
    if (fp > peak) peak = fp
  }
  return { levels, clip, clipFrames, peak }
}

export const countOn = (a: Uint8Array): number => a.reduce((n, v) => n + v, 0)

/** Talk and pause masks from one input's frame levels. */
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

/** One window cut into frames, both inputs lined up, talk and pauses classified. */
export interface LiveFrames {
  sampleRate: number
  /** Samples per frame. */
  win: number
  /** Frames in the window. */
  nF: number
  /** Frame f covers samples off + f·win … off + (f+1)·win of raw and fx: the last frame ends with the aligned stretch. */
  off: number
  /** Aligned samples, raw[i] and fx[i] at the same instant (fx time). raw null without a raw mic. */
  raw: Float32Array | null
  fx: Float32Array
  rawFrames: Frames | null
  fxFrames: Frames
  talk: Uint8Array
  pause: Uint8Array
  talkFrames: number
  /** Samples between the end of the aligned stretch and the end of fxWin (> 0 only when fx runs ahead of raw). */
  endTrim: number
}

/**
 * Frames of one window. rawWin and fxWin end at the same instant; rawWin may be longer so that, shifted by the lag, it
 * still covers the whole fx window. fx sample j is paired with the raw sample lagMs earlier; only the paired stretch is
 * analysed, cut into frames that end with it. Talk and pauses are classified on the raw mic (on fx without one, or when
 * the raw mic stays silent) and the same frames are measured on both inputs.
 */
export function liveFrames(rawWin: Float32Array | null, fxWin: Float32Array, sampleRate: number, lagMs: number | null): LiveFrames {
  const win = frameLen(sampleRate)
  let fx = fxWin
  let raw: Float32Array | null = null
  let endTrim = 0
  if (rawWin) {
    const lag = Math.round(((lagMs ?? 0) * sampleRate) / 1000)
    const offset = rawWin.length - fxWin.length - lag
    const j0 = Math.max(0, -offset)
    const j1 = Math.max(j0, Math.min(fxWin.length, rawWin.length - offset))
    fx = fxWin.subarray(j0, j1)
    raw = rawWin.subarray(j0 + offset, j1 + offset)
    endTrim = fxWin.length - j1
  }
  const nF = Math.floor(fx.length / win)
  const off = fx.length - nF * win
  const fxFrames = frameStats(fx, off, win, nF)
  const rawFrames = raw ? frameStats(raw, off, win, nF) : null
  // talk/pause come from the raw mic; a silent raw input (wrong device picked) falls back to the Wave Link output
  let { talk, pause } = classifyFrames((rawFrames ?? fxFrames).levels)
  if (rawFrames && countOn(talk) * FRAME_SEC < MIN_TALK_SEC) {
    const viaFx = classifyFrames(fxFrames.levels)
    if (countOn(viaFx.talk) * FRAME_SEC >= MIN_TALK_SEC) ({ talk, pause } = viaFx)
  }
  return { sampleRate, win, nF, off, raw, fx, rawFrames, fxFrames, talk, pause, talkFrames: countOn(talk), endTrim }
}

/** Reusable buffers for talk-frame power spectra of one frame length (powerSpec() without its allocations). */
export interface SpecScratch {
  /** FFT size. */
  n: number
  /** Offset of the FFT inside a frame (centred). */
  pad: number
  w: Float64Array
  re: Float64Array
  im: Float64Array
}

export function specScratch(win: number): SpecScratch {
  const n = Math.min(TONE_FFT, 2 ** Math.floor(Math.log2(win)))
  return { n, pad: Math.floor((win - n) / 2), w: hann(n), re: new Float64Array(n), im: new Float64Array(n) }
}

/** Adds the Hann-windowed power spectrum of the frame starting at x[frameStart] to spec (n/2 + 1 bins). */
export function addFramePower(x: Float32Array, frameStart: number, sc: SpecScratch, spec: Float64Array): void {
  const { n, w, re, im } = sc
  const s0 = frameStart + sc.pad
  for (let i = 0; i < n; i++) re[i] = (x[s0 + i] || 0) * w[i]
  im.fill(0)
  fft(re, im)
  for (let i = 0; i <= n / 2; i++) spec[i] += re[i] * re[i] + im[i] * im[i]
}

/** Linear power per BANDS entry of an n-point power spectrum. */
export function bandEnergies(spec: Float64Array, sampleRate: number, n: number): number[] {
  const binHz = sampleRate / n
  return BANDS.map((b) => {
    let s = 0
    for (let i = Math.ceil(b.lo / binHz); i < b.hi / binHz && i < spec.length; i++) s += spec[i]
    return s
  })
}

/** Band energies (dB) relative to the 640–1250 Hz band, as analyze's `rel`. */
export function relBands(energies: ArrayLike<number>): number[] {
  const e = Array.from(energies, db)
  return e.map((v) => v - e[4])
}

/**
 * digitalSilence()'s zeroRatio over a stream fed in pieces: exact-zero runs of at least ZERO_RUN_SEC count, a run may
 * span pieces. cut() ends the current run (the next piece does not continue this one).
 */
export class ZeroRuns {
  private readonly minRun: number
  private inRuns = 0
  private run = 0
  private total = 0

  constructor(sampleRate: number) {
    this.minRun = Math.max(1, Math.round(ZERO_RUN_SEC * sampleRate))
  }

  push(x: Float32Array): void {
    for (let i = 0; i < x.length; i++) {
      if (x[i] === 0) this.run++
      else if (this.run) this.cut()
    }
    this.total += x.length
  }

  cut(): void {
    if (this.run >= this.minRun) this.inRuns += this.run
    this.run = 0
  }

  /** Share of the samples fed that sit in zero runs, 0..1 (0 before any sample). */
  get ratio(): number {
    if (!this.total) return 0
    return (this.inRuns + (this.run >= this.minRun ? this.run : 0)) / this.total
  }
}
