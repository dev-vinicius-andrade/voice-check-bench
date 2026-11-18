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

/**
 * Chopping measured directly (cutOf): the render against the same chain with its gates passing everything, in
 * CUT_FRAME_SEC frames over the speech and CUT_PAD_SEC before and after it (word onsets and tails). A frame that
 * carries voice (CUT_VOICE_DB over the room in the ungated render) is cut when the gated render sits more than CUT_DB
 * under the ungated one; a cut event is CUT_MIN_FRAMES such frames in a row.
 */
export const CUT_FRAME_SEC = 0.01
export const CUT_PAD_SEC = 0.15
export const CUT_DB = 3
/** A frame this far under the ungated render counts in full (a gate closed to Dry −20); between CUT_DB and this, by its depth. */
export const CUT_FULL_DB = 20
/** A cut event is frames this far under the ungated render: a floor of Dry −6 turns the voice down, it does not cut it. */
export const CUT_EVENT_DB = 8
export const CUT_VOICE_DB = 6
export const CUT_MIN_FRAMES = 2
/**
 * Room noise in the tone. A band of the RAW take whose speech windows are not MASK_DB over its pause windows carries
 * no measurable voice (on the real take 640 Hz–2.5 kHz read +0.6 / +1.3 dB: room, not voice): it is masked, NaN in
 * every render of that take, so a remover that takes the room out is not read as taking the voice out. In the other
 * bands the render's own pause spectrum is subtracted from its speech spectrum, never below NOISE_FLOOR_SHARE of it.
 */
export const MASK_DB = 3
export const NOISE_FLOOR_SHARE = 0.1
export const MIN_PAUSE_WINDOWS = 3
/**
 * Pumping: a gate that turns the room down in the pauses and lets it back between the words. Counted when the room is
 * audible in the ungated chain (its voice less than PUMP_AUDIBLE_SNR_DB over its pauses), as the dB the gate takes off
 * the pauses.
 */
export const PUMP_AUDIBLE_SNR_DB = 35

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
  /** Start samples of the FFT windows that lie in pause frames only (the room alone). */
  pauseWindows: number[]
  /** Per BANDS entry: the raw take has no measurable voice there (not MASK_DB over the room). */
  masked: boolean[]
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
  /** How far a gate moves an audible room between pauses and words, dB (cutOf; filled in with cutShare). */
  pumpDb: number
  /**
   * Speech cut by a gate (cutOf), filled in by the session when it has the ungated render of the same chain: share of
   * the voice frames that are cut (0..1) and cut events per 10 s. NaN while not measured.
   */
  cutShare: number
  cutEvents: number
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

  const isPause = new Uint8Array(frames)
  for (const f of pause) isPause[f] = 1
  const pauseWindows: number[] = []
  for (let st = 0; st + FFT_N <= take.length; st += FFT_HOP) {
    let all = true
    for (let f = Math.floor(st / win); f <= Math.floor((st + FFT_N - 1) / win); f++) if (f >= frames || !isPause[f]) all = false
    if (all) pauseWindows.push(st)
  }
  const layout = cellLayout(sampleRate)
  const voice = sumCells(take, windows, layout.binCell)
  const room = sumCells(take, pauseWindows, layout.binCell)
  const masked = Array.from({ length: N_BANDS }, (_, b) => {
    if (pauseWindows.length < MIN_PAUSE_WINDOWS || !windows.length) return false
    let s = 0
    let n = 0
    for (let k = 0; k < CELLS_PER_BAND; k++) {
      s += voice[b * CELLS_PER_BAND + k] / windows.length
      n += room[b * CELLS_PER_BAND + k] / pauseWindows.length
    }
    return s < n * 10 ** (MASK_DB / 10)
  })
  return { sampleRate, win, frames, rawLevels: fr, speech, loud, quiet, pause, seconds, windows, pauseWindows, masked, ...layout, analysis: a }
}

/** Summed power per cell over FFT windows. */
function sumCells(x: Float32Array, starts: readonly number[], binCell: Int16Array): Float64Array {
  const cells = new Float64Array(N_CELLS)
  for (const st of starts) {
    const p = powerSpec(x, st, FFT_N)
    for (let i = 0; i < p.length; i++) {
      const c = binCell[i]
      if (c >= 0) cells[c] += p[i]
    }
  }
  return cells
}

/** The speech spectrum of a render without the room: masked bands NaN, the render's pause spectrum taken off the rest. */
function voiceCells(mask: TakeMask, audio: Float32Array): Float64Array {
  const cells = sumCells(audio, mask.windows, mask.binCell)
  const room = mask.pauseWindows.length >= MIN_PAUSE_WINDOWS ? sumCells(audio, mask.pauseWindows, mask.binCell) : null
  const k = mask.windows.length / Math.max(1, mask.pauseWindows.length)
  for (let c = 0; c < N_CELLS; c++) {
    if (mask.masked[Math.floor(c / CELLS_PER_BAND)]) cells[c] = NaN
    else if (room) cells[c] = Math.max(cells[c] - room[c] * k, cells[c] * NOISE_FLOOR_SHARE)
  }
  return cells
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

  const cells = voiceCells(mask, audio)

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
    cutShare: NaN,
    cutEvents: NaN,
    pumpDb: NaN,
    cells,
  }
}

/** Level of each CUT_FRAME_SEC frame, dBFS (floored at FLOOR_DB). */
export function fineLevels(x: Float32Array, sampleRate: number): Float32Array {
  const w = Math.round(CUT_FRAME_SEC * sampleRate)
  const out = new Float32Array(Math.floor(x.length / w))
  for (let f = 0; f < out.length; f++) {
    let s = 0
    for (let i = f * w; i < (f + 1) * w; i++) s += x[i] * x[i]
    out[f] = Math.max(FLOOR_DB, adb(Math.sqrt(s / w)))
  }
  return out
}

/**
 * How much speech a gate cuts: `gated` is a render, `open` the fineLevels of the same chain rendered with its gates
 * passing everything. Over the speech frames of the raw take and CUT_PAD_SEC around them, the frames that carry voice
 * in the ungated render (CUT_VOICE_DB over its pause level) are compared: one is cut when the gated render sits more
 * than CUT_DB under the ungated one, after the gain the open gate adds (the median difference over the loud half of
 * the speech). `share`: cut voice frames / voice frames, each cut frame weighted by its depth (CUT_DB → 0,
 * CUT_FULL_DB → 1: a word start held 6 dB down is heard far less than one held 20 dB down); `events`: runs of
 * CUT_MIN_FRAMES frames more than CUT_EVENT_DB under, per 10 s of that region. The whole-take word loss (median gain of the quiet quarter) cannot see a word start or tail cut for 50 ms.
 */
export function cutOf(mask: TakeMask, gated: Float32Array, open: Float32Array): { share: number; events: number; pump: number } {
  const per = Math.round(FRAME_SEC / CUT_FRAME_SEC)
  const g = fineLevels(gated, mask.sampleRate)
  const n = Math.min(g.length, open.length)
  const pad = Math.round(CUT_PAD_SEC / FRAME_SEC)
  const region = new Uint8Array(mask.frames)
  for (const f of mask.speech) for (let k = Math.max(0, f - pad); k <= Math.min(mask.frames - 1, f + pad); k++) region[k] = 1
  const fine = (frames: readonly number[], of: (i: number) => number): number[] => {
    const out: number[] = []
    for (const f of frames) for (let j = 0; j < per && f * per + j < n; j++) out.push(of(f * per + j))
    return out
  }
  const room = mask.pause.length >= MIN_PAUSE_FRAMES ? median(fine(mask.pause, (i) => open[i])) : -Infinity
  const diffs = fine(mask.loud, (i) => g[i] - open[i])
  const gain = diffs.length ? median(diffs) : 0
  let voice = 0
  let cut = 0
  let events = 0
  let run = 0
  let frames = 0
  for (let f = 0; f < mask.frames; f++) {
    if (!region[f]) {
      run = 0
      continue
    }
    for (let j = 0; j < per && f * per + j < n; j++) {
      const i = f * per + j
      frames++
      if (!(open[i] >= room + CUT_VOICE_DB)) {
        run = 0
        continue
      }
      voice++
      const depth = open[i] + gain - g[i]
      if (depth > CUT_DB) cut += Math.min(1, (depth - CUT_DB) / (CUT_FULL_DB - CUT_DB))
      if (depth > CUT_EVENT_DB) {
        if (++run === CUT_MIN_FRAMES) events++
      } else run = 0
    }
  }
  // pumping: what the gate takes off the pauses of a room that is audible without it
  const loud = fine(mask.loud, (i) => open[i])
  const audible = Number.isFinite(room) && loud.length > 0 && median(loud) - room < PUMP_AUDIBLE_SNR_DB
  const depth = mask.pause.length >= MIN_PAUSE_FRAMES ? median(fine(mask.pause, (i) => open[i] + gain - g[i])) : 0
  return { share: voice ? cut / voice : 0, events: frames ? (events / (frames * CUT_FRAME_SEC)) * 10 : 0, pump: audible ? Math.max(0, depth) : 0 }
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
