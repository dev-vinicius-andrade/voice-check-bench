// Whole-take measurement for the tuner. Pure.
// The raw take is analysed once (analyze()): its speech frames, pause frames and speech windows become a fixed mask.
// Every render of that take is aligned to it, so it is measured on the very same frames. A gate or a noise remover
// then cannot change what counts as speech, and the difference between two renders is only what the chain did.
import { analyze, digitalSilence, FLOOR_DB, SPEECH_MARGINS } from '../../audio/analyze'
import { adb, db, median, pct, powerSpec } from '../../audio/dsp'
import { BANDS, QUIET_SEC } from '../../audio/reference'
import { isAnalysisError, type Analysis, type VoiceStyle } from '../../types'
import { N_BANDS, styleOffsets } from './targets'

export const TUNE_SAMPLE_RATE = 48000
/** Frame length, seconds (as analyze()). */
const FRAME_SEC = 0.05
/** Long-term spectrum (as analyze()): FFT size and hop. */
const FFT_N = 8192
const FFT_HOP = 4096
/** Each band is split into this many log-spaced cells, so the EQ model sees the spectrum inside a band. */
export const CELLS_PER_BAND = 6
export const N_CELLS = N_BANDS * CELLS_PER_BAND
/** A pause frame is at most this far above the room noise, dB, and at least PAUSE_GUARD frames away from speech. */
export const PAUSE_MARGIN_DB = 6
const PAUSE_GUARD = 2
/** Fewer pause frames than this: pause noise is not measured. */
export const MIN_PAUSE_FRAMES = 10
/** Speech frames at or under this level: the render lost the voice altogether, dBFS. */
export const SILENT_DB = FLOOR_DB + 15

/** The fixed frames of a take, from the raw recording. */
export interface TakeMask {
  sampleRate: number
  /** Samples per frame and number of frames. */
  win: number
  frames: number
  /** Level of each raw frame, dBFS (floored at FLOOR_DB). */
  rawLevels: Float64Array
  /** Frame indexes: speech, its loud half, its quietest quarter, and pauses (room noise only). */
  speech: number[]
  loud: number[]
  quiet: number[]
  pause: number[]
  /** Per second of the speech part: the voiced frames (within 12 dB of the speech median), when there are ≥ 4. */
  seconds: number[][]
  /** Start samples of the FFT windows that are mostly speech. */
  windows: number[]
  /** Cell of each FFT bin (−1: outside the bands). */
  binCell: Int16Array
  /** Centre frequency of each cell, Hz. */
  cellHz: number[]
  /** The raw take's analysis. */
  analysis: Analysis
}

/** What one render measures (targets come later: ./score.ts). */
export interface Measured {
  speechDb: number
  peakDb: number
  clipped: number
  pauseDb: number
  snrDb: number
  spreadDb: number
  deadSilence: number
  gateSwitches: number
  wordLossDb: number
  /**
   * Sample peaks a gate's detector reacts to (ReaGate with its RMS size at 0 opens on peaks): P90 of the pause
   * frames' peaks, and P10 of the quietest speech frames' peaks, dBFS (NaN without such frames).
   */
  pausePeakDb: number
  quietPeakDb: number
  /** The voice is gone (speech at SILENT_DB or under): nothing but the level and the damage can be judged. */
  silent: boolean
  /** Summed speech power per cell (N_CELLS). */
  cells: Float64Array
}

function frameLevels(x: Float32Array, win: number, frames: number): Float64Array {
  const fr = new Float64Array(frames)
  for (let f = 0; f < frames; f++) {
    let s = 0
    const end = Math.min(x.length, (f + 1) * win)
    for (let i = f * win; i < end; i++) s += x[i] * x[i]
    fr[f] = Math.max(FLOOR_DB, adb(Math.sqrt(s / win)))
  }
  return fr
}

/** Cell layout of the 8192-point spectrum: each band's bins (the same bins analyze() sums) split into log cells. */
function cellLayout(sampleRate: number): { binCell: Int16Array; cellHz: number[] } {
  const binHz = sampleRate / FFT_N
  const binCell = new Int16Array(FFT_N / 2 + 1).fill(-1)
  const cellHz: number[] = []
  BANDS.forEach((b, bi) => {
    const octaves = Math.log(b.hi / b.lo)
    for (let k = 0; k < CELLS_PER_BAND; k++) cellHz.push(b.lo * Math.exp((octaves * (k + 0.5)) / CELLS_PER_BAND))
    for (let i = Math.ceil(b.lo / binHz); i < b.hi / binHz && i < binCell.length; i++) {
      const k = Math.min(CELLS_PER_BAND - 1, Math.max(0, Math.floor((Math.log((i * binHz) / b.lo) / octaves) * CELLS_PER_BAND)))
      binCell[i] = bi * CELLS_PER_BAND + k
    }
  })
  return { binCell, cellHz }
}

/**
 * The fixed frames of a raw take, with analyze()'s own rules: 50 ms frames, speech = frames after the quiet lead
 * that clear the room noise by the first SPEECH_MARGINS entry giving 20 frames, voiced = within 12 dB of the speech
 * median, speech windows = 8192-point windows with ≥ 60 % speech frames. Pauses = frames of the quiet lead (0.6 s in,
 * 0.3 s before its end) and between the words that stay within PAUSE_MARGIN_DB of the room noise and are not next to
 * speech. Null when the take cannot be analysed (not enough speech).
 */
export function prepareTake(take: Float32Array, sampleRate = TUNE_SAMPLE_RATE): TakeMask | null {
  const a = analyze(take, sampleRate)
  if (isAnalysisError(a)) return null
  const win = Math.round(FRAME_SEC * sampleRate)
  const frames = Math.floor(take.length / win)
  const fr = frameLevels(take, win, frames)
  const sStart = Math.round(QUIET_SEC / FRAME_SEC)
  const from = a.noiseFromQuiet ? sStart : 0

  let speech: number[] = []
  for (const margin of SPEECH_MARGINS) {
    speech = []
    for (let f = from; f < frames; f++) if (fr[f] > a.noise + margin && fr[f] > -70) speech.push(f)
    if (speech.length >= 20) break
  }
  if (speech.length < 20) return null
  const isSpeech = new Uint8Array(frames)
  for (const f of speech) isSpeech[f] = 1

  const levels = speech.map((f) => fr[f])
  const med = median(levels)
  const q25 = pct(levels, 0.25)
  const loud = speech.filter((f) => fr[f] >= med)
  const quiet = speech.filter((f) => fr[f] <= q25)

  const leadA = Math.round(0.6 / FRAME_SEC)
  const leadB = Math.round((QUIET_SEC - 0.3) / FRAME_SEC)
  const pause: number[] = []
  for (let f = leadA; f < frames; f++) {
    if (f >= leadB && f < sStart) continue
    if (fr[f] > a.noise + PAUSE_MARGIN_DB) continue
    let near = false
    for (let k = Math.max(0, f - PAUSE_GUARD); k <= Math.min(frames - 1, f + PAUSE_GUARD); k++) if (isSpeech[k]) near = true
    if (!near) pause.push(f)
  }

  const fps = Math.round(1 / FRAME_SEC)
  const seconds: number[][] = []
  for (let s = sStart; s < frames; s += fps) {
    const voiced: number[] = []
    for (let f = s; f < Math.min(s + fps, frames); f++) if (fr[f] > med - 12) voiced.push(f)
    if (voiced.length >= 4) seconds.push(voiced)
  }

  const windows: number[] = []
  const perWindow = FFT_N / win
  for (let st = 0; st + FFT_N <= take.length; st += FFT_HOP) {
    let n = 0
    for (let f = Math.floor(st / win); f < Math.floor((st + FFT_N) / win) && f < frames; f++) n += isSpeech[f]
    if (n >= perWindow * 0.6) windows.push(st)
  }

  return { sampleRate, win, frames, rawLevels: fr, speech, loud, quiet, pause, seconds, windows, ...cellLayout(sampleRate), analysis: a }
}

const medianAt = (levels: Float64Array, idx: readonly number[]): number => (idx.length ? median(idx.map((f) => levels[f])) : NaN)

/** Percentile `p` of the frames' sample peaks, dBFS (FLOOR_DB at the bottom; NaN without frames). */
function peakPct(x: Float32Array, win: number, idx: readonly number[], p: number): number {
  if (!idx.length) return NaN
  const peaks = idx.map((f) => {
    let m = 0
    for (let i = f * win; i < Math.min(x.length, (f + 1) * win); i++) m = Math.max(m, Math.abs(x[i]))
    return Math.max(FLOOR_DB, adb(m))
  })
  return pct(peaks, p)
}

/**
 * Measures a render on the take's fixed frames.
 * - speechDb: median level of the speech frames · pauseDb: median level of the pause frames · snrDb: the difference.
 * - spreadDb: P90 − P10 of the loudest voiced frame of each second (analyze()'s consistency), 0 under 3 seconds.
 * - wordLossDb: median gain (render − raw) of the loud half of the speech frames minus that of the quietest quarter.
 *   A compressor makes it negative (quiet syllables come up); a gate or a noise remover closing on quiet syllables
 *   makes it positive.
 * - deadSilence / gateSwitches: digitalSilence() of the render.
 * - pausePeakDb / quietPeakDb: P90 of the pause frames' sample peaks, P10 of the quietest speech frames' peaks.
 * - cells: speech power per cell over the speech windows.
 * - silent: the speech frames sit at SILENT_DB or under (something cut the voice out entirely).
 */
export function measure(mask: TakeMask, audio: Float32Array): Measured {
  let peak = 0
  let clipped = 0
  for (let i = 0; i < audio.length; i++) {
    const v = Math.abs(audio[i])
    if (v > peak) peak = v
    if (v >= 0.999) clipped++
  }
  const fr = frameLevels(audio, mask.win, mask.frames)
  const speechDb = medianAt(fr, mask.speech)
  const pauseDb = mask.pause.length >= MIN_PAUSE_FRAMES ? medianAt(fr, mask.pause) : NaN

  const perSec = mask.seconds.map((voiced) => voiced.reduce((m, f) => Math.max(m, fr[f]), -Infinity))
  const spreadDb = perSec.length > 2 ? pct(perSec, 0.9) - pct(perSec, 0.1) : 0

  const gain = (idx: readonly number[]): number => (idx.length ? median(idx.map((f) => fr[f] - mask.rawLevels[f])) : NaN)
  const loss = gain(mask.loud) - gain(mask.quiet)

  const cells = new Float64Array(N_CELLS)
  for (const st of mask.windows) {
    const p = powerSpec(audio, st, FFT_N)
    for (let i = 0; i < p.length; i++) {
      const c = mask.binCell[i]
      if (c >= 0) cells[c] += p[i]
    }
  }

  const zero = digitalSilence(audio, mask.sampleRate)
  return {
    speechDb,
    peakDb: adb(peak),
    clipped,
    pauseDb,
    snrDb: speechDb - pauseDb,
    spreadDb,
    deadSilence: zero.zeroRatio,
    gateSwitches: zero.gateSwitches,
    wordLossDb: Number.isFinite(loss) ? loss : 0,
    pausePeakDb: mask.pause.length >= MIN_PAUSE_FRAMES ? peakPct(audio, mask.win, mask.pause, 0.9) : NaN,
    quietPeakDb: peakPct(audio, mask.win, mask.quiet, 0.1),
    silent: !(speechDb > SILENT_DB),
    cells,
  }
}

/** Speech energy of each band, dB, from the cells (analyze()'s band sums; `rel` is these minus the body band). */
export function bandsOfCells(cells: ArrayLike<number>): number[] {
  const e: number[] = []
  for (let b = 0; b < N_BANDS; b++) {
    let s = 0
    for (let k = 0; k < CELLS_PER_BAND; k++) s += cells[b * CELLS_PER_BAND + k]
    e.push(db(s))
  }
  return e
}

/** Each band's distance from the style's target curve before level-matching, dB. */
const offTarget = (bands: readonly number[], style: VoiceStyle): number[] => {
  const off = styleOffsets(style)
  return bands.map((v, i) => v - BANDS[i].ref - (off[i] ?? 0))
}

/**
 * The level that matches a take to the target curve, robustly: the MEDIAN of the seven speech bands' distances
 * (boom … sibilance), not their mean. deviations() in src/audio/reference.ts averages all seven, so one deep low-cut
 * (boom −20 dB) reads as every other band being 3–4 dB too loud; with the median, up to three outlying bands cannot
 * move the others, and the level stays put when an EQ repairs them. NaN with fewer than three usable bands.
 */
export function toneLevel(bands: readonly number[], style: VoiceStyle): number {
  const mid = offTarget(bands, style).slice(1, 8).filter(Number.isFinite)
  return mid.length < 3 ? NaN : median(mid)
}

/** Deviation of each band from the style's target at a given matching level, dB. */
export const toneAt = (bands: readonly number[], style: VoiceStyle, level: number): number[] => offTarget(bands, style).map((v) => v - level)

/** Deviation of each band from the goal style's target, level-matched robustly (toneLevel). Takes band levels or `rel`. */
export const robustTone = (bands: readonly number[], style: VoiceStyle): number[] => toneAt(bands, style, toneLevel(bands, style))
