// Whole-take measurement for the tuner. Pure.
// The raw take is analysed once (analyze()): its speech frames, pause frames and speech windows become a fixed mask.
// Every render of that take is aligned to it, so it is measured on the very same frames. A gate or a noise remover
// then cannot change what counts as speech, and the difference between two renders is only what the chain did.
import { analyze, digitalSilence, FLOOR_DB, SPEECH_MARGINS } from '../../audio/analyze'
import { adb, db, median, pct, powerSpec } from '../../audio/dsp'
import { BANDS, QUIET_SEC } from '../../audio/reference'
import { isAnalysisError, type Analysis, type VoiceStyle } from '../../types'
import { steadyTonesOf } from '../spectrum/steady'
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
export const PAUSE_GUARD = 2
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
 * Steady tones in the tone measure. A steady narrow tone of the RAW take (a whistle of the mic chain, coil whine, a
 * hum's harmonic: steadyTonesOf, the spectrum plot's own tone tracker over the whole take) is not voice: its FFT_N
 * bins, the tone's bin ± TONE_CUT_BINS, are left out of every cell sum of the tone measure (speech and pause windows,
 * the raw take's mask test and every render alike). The tones come from the raw take only, so a render with the tone
 * cut and one with it are measured on the same bins. Width: the Hann window's main lobe is ±2 bins; 2 bins more keep
 * all but −47.5 dB of the tone's power out (±2 alone: −33 dB; a 27 dB whistle would still show) and cover the
 * tracker's 2.9 Hz resolution and a tone drifting a few Hz. At 48 kHz: ±23 Hz.
 * The cell keeps its own density: its sum is scaled back to all its bins (bins / bins kept); a cell with none left
 * takes its band's mean density; a band with none left carries no measurable voice (masked).
 */
export const TONE_CUT_BINS = 4
/**
 * Pumping: a gate that turns the room down in the pauses and lets it back between the words. Counted when the room is
 * audible in the ungated chain (its voice less than PUMP_AUDIBLE_SNR_DB over its pauses), as the dB the gate takes off
 * the pauses.
 */
export const PUMP_AUDIBLE_SNR_DB = 35

/**
 * Bursts in the pauses: a remover that lets the room through for a moment (Elgato Noise Removal right after some
 * words, or on and off in a long pause when the room it receives sits near its threshold). The median pause level
 * reads digital silence there; what is heard against that silence is the loudest moments. Measured in CUT_FRAME_SEC
 * frames over the take's room frames (TakeMask.roomFrames):
 * - the pauses of the raw take from BURST_FROM_SEC on (the render resets every plugin and feeds silence first, so Noise
 *   Removal starts cold: on the real chain its first 0.7 s let the room through and a warm-up with the take's own room
 *   took that away and nothing else; the live engine at real-time pace gave the same output as the offline render),
 * - BURST_GUARD_SEC or more from speech (word tails: the cut measure's own pad),
 * - where the raw take is the room alone: no band of a BURST_FFT-point spectrum BURST_ROOM_DB over the room's median
 *   there (a breath, an "s" or a soft syllable at room level is the person's own sound, which a remover rightly keeps),
 *   widened by BURST_SOUND_PAD frames.
 * A burst is BURST_MIN_FRAMES frames in a row (30 ms: a single click of the room is no burst; the ones heard on the real
 * chain lasted 50–300 ms) over both the pauses' own median (+ BURST_OVER_DB: as far as a gate may
 * move an audible room before it pumps, score.ts PUMP_OK_DB, plus what one 10 ms frame of a steady room swings, so a
 * gentle gate's floor is no burst) and the audible line (BURST_AUDIBLE_DB under the voice); its level is its loudest
 * BURST_MIN_FRAMES frames (power mean: a burst is heard at its loudest, and a single 10 ms frame swings too much).
 * Fewer than MIN_ROOM_FRAMES room frames: not measured.
 */
export const BURST_FROM_SEC = 1
export const BURST_GUARD_SEC = CUT_PAD_SEC
export const BURST_FFT = 1024
export const BURST_ROOM_DB = 6
export const BURST_SOUND_PAD = 3
export const BURST_OVER_DB = 16
export const BURST_AUDIBLE_DB = 45
export const BURST_MIN_FRAMES = 3
export const MIN_ROOM_FRAMES = 50
/** Bands of the room test, Hz (low voice, the middle, consonants, hiss). */
const ROOM_TEST_BANDS: readonly (readonly [number, number])[] = [
  [80, 320],
  [320, 1250],
  [1250, 2500],
  [2500, 5000],
  [5000, 10000],
]

/**
 * A mains hum in the room ("low hum or rumble"): a peak at 50 or 60 Hz or one of their next two harmonics in the raw
 * take's pause spectrum (FFT_N points, 5.9 Hz bins) standing HUM_OVER_DB over the median of its neighbourhood (bins
 * HUM_NEAR away on either side, the peak's own ±1 left out).
 */
export const HUM_MAINS_HZ: readonly number[] = [50, 60]
export const HUM_HARMONICS = 3
export const HUM_OVER_DB = 10
const HUM_NEAR: readonly [number, number] = [3, 8]
/** "High hiss": the top of the spectrum, from this frequency up to the last band's top, Hz. */
export const HISS_FROM_HZ = 8000

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
  /** CUT_FRAME_SEC frames of the pauses where the raw take is the room alone, ascending (bursts are measured there). */
  roomFrames: number[]
  /** Level of each CUT_FRAME_SEC frame of the raw take, dBFS (fineLevels). */
  rawFine: Float32Array
  /** The frequency of a mains hum in the raw take's pauses (the strongest peak of humPeaks), Hz; NaN without one. */
  humHz: number
  /** Steady tones of the raw take (steadyTonesOf), Hz, strongest first; empty without one. Their bins: TONE_CUT_BINS. */
  steadyHz: number[]
  /** Cell of each FFT bin (−1: outside the bands, or a steady tone's bin). */
  binCell: Int16Array
  /** Per cell, its bins and the bins left after the steady tones' (TONE_CUT_BINS); null when no bin is left out. */
  cellFill: CellFill | null
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
  /**
   * Bursts in the pauses (burstsOf): how far under the voice the loudest one sits, dB (NaN: none, or not measurable),
   * and how many there are per 10 s of the take's room frames (NaN: not measurable).
   */
  burstDb: number
  burstEvents: number
  /**
   * What Noise Removal and the gates cut of the words together, against the chain without Noise Removal and with its
   * gates passing everything (./burstStage.ts, on the final state): share and events as cutShare / cutEvents. NaN while
   * not measured (no Noise Removal on, or not the final stage's render).
   */
  removerCut: number
  removerCutEvents: number
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

/** Bins of each cell, and those left after the steady tones' (TONE_CUT_BINS). */
export interface CellFill {
  bins: Int16Array
  kept: Int16Array
}

/**
 * Cell layout of the 8192-point spectrum: each band's bins (the same bins analyze() sums) split into log cells; the
 * bins of the steady tones at `steadyHz` (± TONE_CUT_BINS) belong to no cell. `cellFill` null when no bin is left out.
 */
function cellLayout(sampleRate: number, steadyHz: readonly number[] = []): { binCell: Int16Array; cellHz: number[]; cellFill: CellFill | null } {
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
  const bins = new Int16Array(N_CELLS)
  for (const c of binCell) if (c >= 0) bins[c]++
  let cut = false
  for (const hz of steadyHz) {
    const k = Math.round(hz / binHz)
    for (let i = Math.max(0, k - TONE_CUT_BINS); i <= Math.min(binCell.length - 1, k + TONE_CUT_BINS); i++) {
      if (binCell[i] >= 0) cut = true
      binCell[i] = -1
    }
  }
  if (!cut) return { binCell, cellHz, cellFill: null }
  const kept = new Int16Array(N_CELLS)
  for (const c of binCell) if (c >= 0) kept[c]++
  return { binCell, cellHz, cellFill: { bins, kept } }
}

/** A band whose bins are all a steady tone's: no voice can be measured there. */
const bandCut = (fill: CellFill | null, b: number): boolean => {
  if (!fill) return false
  let bins = 0
  let kept = 0
  for (let k = 0; k < CELLS_PER_BAND; k++) {
    bins += fill.bins[b * CELLS_PER_BAND + k]
    kept += fill.kept[b * CELLS_PER_BAND + k]
  }
  return bins > 0 && kept === 0
}

/** Cell sums over the bins kept, scaled back to all the cell's bins (TONE_CUT_BINS); a cell with none kept takes its band's mean density. */
function refill(cells: Float64Array, fill: CellFill): void {
  for (let b = 0; b < N_BANDS; b++) {
    let sum = 0
    let kept = 0
    for (let k = 0; k < CELLS_PER_BAND; k++) {
      sum += cells[b * CELLS_PER_BAND + k]
      kept += fill.kept[b * CELLS_PER_BAND + k]
    }
    const density = kept ? sum / kept : 0
    for (let k = 0; k < CELLS_PER_BAND; k++) {
      const c = b * CELLS_PER_BAND + k
      if (fill.kept[c] === fill.bins[c]) continue
      cells[c] = fill.kept[c] ? (cells[c] * fill.bins[c]) / fill.kept[c] : density * fill.bins[c]
    }
  }
}

/**
 * The fixed frames of a raw take, with analyze()'s own rules: 50 ms frames, speech = frames after the quiet lead
 * that clear the room noise by the first SPEECH_MARGINS entry giving 20 frames, voiced = within 12 dB of the speech
 * median, speech windows = 8192-point windows with ≥ 60 % speech frames. Pauses = frames of the quiet lead (0.6 s in,
 * 0.3 s before its end) and between the words that stay within PAUSE_MARGIN_DB of the room noise and are not next to
 * speech. Steady tones (steadyHz) are found once here; their bins stay out of the tone measure (TONE_CUT_BINS).
 * Null when the take cannot be analysed (not enough speech).
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
  const steadyHz = steadyTonesOf(take, sampleRate).map((t) => t.freqHz)
  const layout = cellLayout(sampleRate, steadyHz)
  const voice = sumCells(take, windows, layout)
  const room = sumCells(take, pauseWindows, layout)
  const masked = Array.from({ length: N_BANDS }, (_, b) => {
    if (bandCut(layout.cellFill, b)) return true
    if (pauseWindows.length < MIN_PAUSE_WINDOWS || !windows.length) return false
    let s = 0
    let n = 0
    for (let k = 0; k < CELLS_PER_BAND; k++) {
      s += voice[b * CELLS_PER_BAND + k] / windows.length
      n += room[b * CELLS_PER_BAND + k] / pauseWindows.length
    }
    return s < n * 10 ** (MASK_DB / 10)
  })
  const roomFrames = roomOnly(take, sampleRate, frames, speech, pause)
  const rawFine = fineLevels(take, sampleRate)
  const humHz = mainsHum(take, pauseWindows, sampleRate)
  return { sampleRate, win, frames, rawLevels: fr, speech, loud, quiet, pause, seconds, windows, pauseWindows, masked, roomFrames, rawFine, humHz, steadyHz, ...layout, analysis: a }
}

/**
 * The CUT_FRAME_SEC frames of the pause frames (50 ms) from BURST_FROM_SEC on, BURST_GUARD_SEC or more from a speech
 * frame, where the raw take is the room alone: around each, a BURST_FFT-point spectrum whose ROOM_TEST_BANDS all stay
 * within BURST_ROOM_DB of their median over those frames; a frame that does not, and BURST_SOUND_PAD frames each side of
 * it, carry a sound of their own.
 */
function roomOnly(take: Float32Array, sampleRate: number, frames: number, speech: readonly number[], pause: readonly number[]): number[] {
  const w = Math.round(CUT_FRAME_SEC * sampleRate)
  const per = Math.round(FRAME_SEC / CUT_FRAME_SEC)
  const guard = Math.round(BURST_GUARD_SEC / CUT_FRAME_SEC)
  const near = new Uint8Array(frames * per)
  for (const f of speech) for (let i = Math.max(0, f * per - guard); i < Math.min(near.length, (f + 1) * per + guard); i++) near[i] = 1
  const from = Math.round(BURST_FROM_SEC / CUT_FRAME_SEC)
  const cand: number[] = []
  for (const f of pause) for (let j = 0; j < per; j++) if (f * per + j >= from && !near[f * per + j]) cand.push(f * per + j)
  if (!cand.length) return []
  const bins = ROOM_TEST_BANDS.map(([lo, hi]) => [Math.ceil((lo * BURST_FFT) / sampleRate), Math.floor((hi * BURST_FFT) / sampleRate)] as const)
  const bands = cand.map((i) => {
    const p = powerSpec(take, Math.max(0, i * w + Math.round(w / 2) - BURST_FFT / 2), BURST_FFT)
    return bins.map(([a, b]) => {
      let s = 0
      for (let k = a; k <= b; k++) s += p[k]
      return db(s)
    })
  })
  const ref = bins.map((_, b) => median(bands.map((x) => x[b])))
  const sound = new Set<number>()
  cand.forEach((i, k) => {
    if (bands[k].every((v, b) => v <= ref[b] + BURST_ROOM_DB)) return
    for (let d = -BURST_SOUND_PAD; d <= BURST_SOUND_PAD; d++) sound.add(i + d)
  })
  return cand.filter((i) => !sound.has(i)).sort((x, y) => x - y)
}

/**
 * Bursts in the pauses of a render (see BURST_FROM_SEC): its CUT_FRAME_SEC levels on the take's room frames; the
 * floor is their median, the line BURST_OVER_DB over it and never under BURST_AUDIBLE_DB under the voice (`speechDb`).
 * A burst is BURST_MIN_FRAMES frames in a row over the line, as loud as its loudest BURST_MIN_FRAMES frames (power
 * mean). `burstDb`: the voice over the loudest one, dB (NaN without a burst); `burstEvents`: bursts per 10 s of room frames. Both NaN with fewer than MIN_ROOM_FRAMES room frames or
 * without a voice level.
 */
export function burstsOf(mask: Pick<TakeMask, 'roomFrames' | 'sampleRate'>, audio: Float32Array, speechDb: number): { burstDb: number; burstEvents: number } {
  const room = mask.roomFrames
  if (room.length < MIN_ROOM_FRAMES || !Number.isFinite(speechDb)) return { burstDb: NaN, burstEvents: NaN }
  const w = Math.round(CUT_FRAME_SEC * mask.sampleRate)
  const level = room.map((f) => {
    let s = 0
    for (let i = f * w; i < Math.min(audio.length, (f + 1) * w); i++) s += audio[i] * audio[i]
    return Math.max(FLOOR_DB, adb(Math.sqrt(s / w)))
  })
  const line = Math.max(median(level) + BURST_OVER_DB, speechDb - BURST_AUDIBLE_DB)
  let loudest = -Infinity
  let events = 0
  for (let k = 0; k < room.length; ) {
    if (!(level[k] > line)) {
      k++
      continue
    }
    // a run of consecutive frames over the line, as loud as its loudest BURST_MIN_FRAMES frames (power mean)
    let e = k
    while (e + 1 < room.length && room[e + 1] === room[e] + 1 && level[e + 1] > line) e++
    if (e - k + 1 >= BURST_MIN_FRAMES) {
      events++
      for (let j = k; j + BURST_MIN_FRAMES - 1 <= e; j++) {
        let power = 0
        for (let i = j; i < j + BURST_MIN_FRAMES; i++) power += 10 ** (level[i] / 10)
        loudest = Math.max(loudest, db(power / BURST_MIN_FRAMES))
      }
    }
    k = e + 1
  }
  return { burstDb: events ? speechDb - loudest : NaN, burstEvents: (events / (room.length * CUT_FRAME_SEC)) * 10 }
}

/** Mean power spectrum (FFT_N points) over FFT windows; null without any. */
function meanSpectrum(x: Float32Array, starts: readonly number[]): Float64Array | null {
  if (!starts.length) return null
  const out = new Float64Array(FFT_N / 2 + 1)
  for (const st of starts) {
    const p = powerSpec(x, st, FFT_N)
    for (let i = 0; i < out.length; i++) out[i] += p[i] / starts.length
  }
  return out
}

/** How far the spectrum's peak at `hz` (its bin ±1) stands over the median of its neighbourhood, dB. */
function peakOver(p: Float64Array, hz: number, sampleRate: number): number {
  const k = Math.round((hz * FFT_N) / sampleRate)
  const near: number[] = []
  for (let d = HUM_NEAR[0]; d <= HUM_NEAR[1]; d++) near.push(p[k - d] ?? 0, p[k + d] ?? 0)
  return db(Math.max(p[k - 1] ?? 0, p[k], p[k + 1] ?? 0)) - db(median(near))
}

/** The mains hum of the raw take's pauses: the strongest peak HUM_OVER_DB over its neighbourhood, Hz (NaN: none). */
function mainsHum(take: Float32Array, pauseWindows: readonly number[], sampleRate: number): number {
  const p = pauseWindows.length >= MIN_PAUSE_WINDOWS ? meanSpectrum(take, pauseWindows) : null
  if (!p) return NaN
  let best = NaN
  let height = HUM_OVER_DB
  for (const base of HUM_MAINS_HZ) {
    for (let h = 1; h <= HUM_HARMONICS; h++) {
      const over = peakOver(p, base * h, sampleRate)
      if (over >= height) {
        height = over
        best = base * h
      }
    }
  }
  return best
}

/** How far the take's hum stands over its neighbourhood in a render's pauses, dB (NaN without a hum or pauses). */
export function humDb(mask: Pick<TakeMask, 'humHz' | 'pauseWindows' | 'sampleRate'>, audio: Float32Array): number {
  const p = Number.isFinite(mask.humHz) ? meanSpectrum(audio, mask.pauseWindows) : null
  return p ? peakOver(p, mask.humHz, mask.sampleRate) : NaN
}

/** The top of a render (HISS_FROM_HZ up to the last band's top) in its pauses and in its speech windows, dBFS-like power. */
export function topDb(mask: Pick<TakeMask, 'windows' | 'pauseWindows' | 'sampleRate'>, audio: Float32Array): { pause: number; speech: number } {
  const top = (starts: readonly number[]): number => {
    const p = meanSpectrum(audio, starts)
    if (!p) return NaN
    let s = 0
    for (let i = Math.ceil((HISS_FROM_HZ * FFT_N) / mask.sampleRate); i < (BANDS[BANDS.length - 1].hi * FFT_N) / mask.sampleRate && i < p.length; i++) s += p[i]
    return db(s)
  }
  return { pause: top(mask.pauseWindows), speech: top(mask.windows) }
}

/** Summed power per cell over FFT windows (the steady tones' bins left out: refill). */
function sumCells(x: Float32Array, starts: readonly number[], layout: Pick<TakeMask, 'binCell' | 'cellFill'>): Float64Array {
  const cells = new Float64Array(N_CELLS)
  const { binCell } = layout
  for (const st of starts) {
    const p = powerSpec(x, st, FFT_N)
    for (let i = 0; i < p.length; i++) {
      const c = binCell[i]
      if (c >= 0) cells[c] += p[i]
    }
  }
  if (layout.cellFill) refill(cells, layout.cellFill)
  return cells
}

/** The speech spectrum of a render without the room: masked bands NaN, the render's pause spectrum taken off the rest. */
function voiceCells(mask: TakeMask, audio: Float32Array): Float64Array {
  const cells = sumCells(audio, mask.windows, mask)
  const room = mask.pauseWindows.length >= MIN_PAUSE_WINDOWS ? sumCells(audio, mask.pauseWindows, mask) : null
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
  const bursts = burstsOf(mask, audio, speechDb)
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
    ...bursts,
    removerCut: NaN,
    removerCutEvents: NaN,
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
 * in the ungated render (CUT_VOICE_DB over its pause level) and in the raw take (CUT_VOICE_DB over its room: a Noise
 * Removal after the gate can let the room through right before or after a word in the ungated render, and a gate that
 * spares it that is not cutting a word) are compared: one is cut when the gated render sits more
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
  const rawRoom = Number.isFinite(mask.analysis.noise) ? mask.analysis.noise : -Infinity
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
      if (!(open[i] >= room + CUT_VOICE_DB) || !(mask.rawFine[i] >= rawRoom + CUT_VOICE_DB)) {
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
