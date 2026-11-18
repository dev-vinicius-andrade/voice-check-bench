// Steady narrow tones (a whistle, a hum's harmonic, coil whine) of one signal: long FFT frames kept for the last
// ~10 s; a tone is a peak of their average that stands well over the spectrum around it AND stood over it in nearly
// every frame (speech harmonics move with the pitch, so they fail that). Pure, framework-free.
import { Framer, medianOf, powDb } from './framer'

/** Long FFT size and hop (341 ms window, 171 ms hop, 2.9 Hz bins at 48 kHz). */
export const TONE_FFT = 16384
export const TONE_HOP = 8192
/** Tones are looked for between these frequencies, Hz. */
export const TONE_MIN_HZ = 60
export const TONE_MAX_HZ = 12000
/** The spectrum around a bin: this many bins each side (±117 Hz at 48 kHz). */
export const TONE_NEIGHBOURS = 40
/** A peak is the highest bin within this many bins each side. */
export const PEAK_SPAN = 3
/** The average over the window must stand this far over the median around it, dB. */
export const TONE_OVER_DB = 12
/**
 * In each frame, "present" = bin k (±1) is that frame's highest within PEAK_SPAN + 1 bins and stands this far over the
 * frame's median around it, dB. The peak test matters where the floor is very low: there a speech harmonic's leakage
 * nearby also stands 8 dB over the median, but its peak sits elsewhere as the pitch moves.
 */
export const FRAME_OVER_DB = 8
/** A tone quieter than this is not reported, dBFS (dither and near-digital-silence artefacts measured at −105..−125). */
export const TONE_MIN_DB = -90
/** Share of the window's frames the tone must be present in. */
export const PRESENT_SHARE = 0.8
/** Seconds of audio, and at least this many frames, needed before anything is reported. */
export const MIN_TONE_SEC = 4
export const MIN_TONE_FRAMES = 12
/** Seconds of frames kept. */
export const TONE_WINDOW_SEC = 10

/** One signal's tone as measured. */
export interface ToneFound {
  freqHz: number
  /** Peak level of the window's average, dBFS (full-scale sine = 0). */
  levelDb: number
  overDb: number
}

export class ToneTracker {
  private readonly framer: Framer
  private readonly binHz: number
  private readonly lowBin: number
  private readonly highBin: number
  /** Bins stored per frame: 0..nBins-1. */
  private readonly nBins: number
  private readonly frames: Float32Array[]
  private readonly minFrames: number
  private head = 0
  private count = 0
  private readonly avg: Float64Array
  private readonly avgDb: Float64Array
  private readonly scratch = new Float64Array(2 * TONE_NEIGHBOURS + 1)
  private found: ToneFound[] = []
  /** Frames arrived since `found` was last worked out: tones() and levelAt() work it out first (same result, once). */
  private stale = false

  /** `windowSec`: seconds of frames kept (TONE_WINDOW_SEC live; a recorded take keeps all of itself). */
  constructor(
    readonly sampleRate: number,
    windowSec = TONE_WINDOW_SEC,
  ) {
    this.binHz = sampleRate / TONE_FFT
    this.lowBin = Math.max(PEAK_SPAN, Math.ceil(TONE_MIN_HZ / this.binHz))
    this.highBin = Math.min(TONE_FFT / 2 - PEAK_SPAN, Math.floor(TONE_MAX_HZ / this.binHz))
    this.nBins = Math.min(TONE_FFT / 2 + 1, this.highBin + TONE_NEIGHBOURS + 2)
    const cap = Math.max(MIN_TONE_FRAMES, Math.round((windowSec * sampleRate) / TONE_HOP))
    this.frames = Array.from({ length: cap }, () => new Float32Array(this.nBins))
    this.minFrames = Math.min(cap, Math.max(MIN_TONE_FRAMES, Math.ceil((MIN_TONE_SEC * sampleRate - TONE_FFT) / TONE_HOP) + 1))
    this.avg = new Float64Array(this.nBins)
    this.avgDb = new Float64Array(this.nBins)
    this.framer = new Framer(TONE_FFT, TONE_HOP, (p) => this.onFrame(p))
  }

  push(x: ArrayLike<number>, n: number): void {
    this.framer.push(x, n)
  }

  reset(): void {
    this.framer.reset()
    this.head = 0
    this.count = 0
    this.found = []
    this.stale = false
    this.analysed++
  }

  /** Frames analysed since the tracker was made (counts on across reset()): changes whenever tones() may have. */
  analysed = 0

  /** Frames in the window now. */
  get frameCount(): number {
    return this.count
  }

  /** Tones of the latest frame, strongest first (empty until MIN_TONE_SEC of frames). */
  tones(): readonly ToneFound[] {
    this.refresh()
    return this.found
  }

  /** Level of the window's average at a frequency, dBFS (the peak within ±1 bin, interpolated); FLOOR_DB when empty. */
  levelAt(freqHz: number): number {
    this.refresh()
    const k = Math.round(freqHz / this.binHz)
    if (!this.count || k < 1 || k >= this.nBins - 1) return powDb(0)
    let m = k
    if (this.avgDb[k - 1] > this.avgDb[m]) m = k - 1
    if (this.avgDb[k + 1] > this.avgDb[m]) m = k + 1
    return m < 1 || m >= this.nBins - 1 ? this.avgDb[m] : this.peak(m).levelDb
  }

  private onFrame(p: Float64Array): void {
    const f = this.frames[this.head]
    for (let k = 0; k < this.nBins; k++) f[k] = p[k]
    this.head = (this.head + 1) % this.frames.length
    if (this.count < this.frames.length) this.count++
    this.stale = true
    this.analysed++
  }

  /** The tones of the latest frame (empty until MIN_TONE_SEC of frames), worked out when frames came in since. */
  private refresh(): void {
    if (!this.stale) return
    this.stale = false
    this.found = this.count >= this.minFrames ? this.detect() : []
  }

  private detect(): ToneFound[] {
    const { avg, avgDb, frames, count, nBins, scratch } = this
    avg.fill(0)
    for (let i = 0; i < count; i++) {
      const f = frames[i]
      for (let k = 0; k < nBins; k++) avg[k] += f[k]
    }
    for (let k = 0; k < nBins; k++) avgDb[k] = powDb(avg[k] / count)
    const out: ToneFound[] = []
    for (let k = this.lowBin; k <= this.highBin; k++) {
      const a = avgDb[k]
      if (!(a > avgDb[k - 1])) continue
      let top = true
      for (let j = k - PEAK_SPAN; j <= k + PEAK_SPAN && top; j++) if (avgDb[j] > a) top = false
      if (!top) continue
      const over = a - medianOf(avgDb, k - TONE_NEIGHBOURS, k + TONE_NEIGHBOURS, scratch)
      if (!(over >= TONE_OVER_DB) || !(this.presentShare(k) >= PRESENT_SHARE)) continue
      const pk = this.peak(k)
      if (!(pk.levelDb >= TONE_MIN_DB)) continue
      out.push({ freqHz: pk.freqHz, levelDb: pk.levelDb, overDb: over + (pk.levelDb - a) })
    }
    return out.sort((x, y) => y.overDb - x.overDb)
  }

  /** Share of the window's frames in which bin k (±1) stood FRAME_OVER_DB over that frame's median around it. */
  private presentShare(k: number): number {
    const ratio = 10 ** (FRAME_OVER_DB / 10)
    let n = 0
    for (let i = 0; i < this.count; i++) {
      const f = this.frames[i]
      const top = Math.max(f[k - 1], f[k], f[k + 1])
      if (!(top > 0)) continue
      let peak = true
      for (let d = 2; d <= PEAK_SPAN + 1 && peak; d++) if (f[k - d] > top || f[k + d] > top) peak = false
      if (peak && top >= ratio * medianOf(f, k - TONE_NEIGHBOURS, k + TONE_NEIGHBOURS, this.scratch)) n++
    }
    return n / this.count
  }

  /** Parabolic interpolation of the average's peak at bin k (in dB): frequency and level. */
  private peak(k: number): { freqHz: number; levelDb: number } {
    const a = this.avgDb[k - 1]
    const b = this.avgDb[k]
    const c = this.avgDb[k + 1]
    const den = a - 2 * b + c
    const d = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0
    return { freqHz: (k + d) * this.binHz, levelDb: b - 0.25 * (a - c) * d }
  }
}
