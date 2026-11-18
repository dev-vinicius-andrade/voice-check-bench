// Live spectrum contract (SPEC "Live spectrum"): what the live screen's spectrum card reads. Framework-free.
import type { AudioFrame } from '../types'

/** The plot's frequency range, Hz, and how many log-spaced points it has. */
export const SPECTRUM_MIN_HZ = 20
export const SPECTRUM_MAX_HZ = 20000
export const SPECTRUM_POINTS = 240
/** At most this many steady tones are reported. */
export const MAX_TONES = 6

/** A steady narrow tone (a whistle, a hum's harmonic, coil whine): present nearly all the time, speech or not. */
export interface SpectrumTone {
  freqHz: number
  /** Its level as heard (processed), dBFS. */
  levelDb: number
  /** How far it stands over the spectrum around it, dB (the larger of mic alone and as heard). */
  overDb: number
  /** Where it was found. */
  inRaw: boolean
  inProcessed: boolean
}

export interface LiveSpectrum {
  /** Centre of each plot point, Hz: SPECTRUM_POINTS log-spaced from SPECTRUM_MIN_HZ to SPECTRUM_MAX_HZ. */
  freqsHz: Float32Array
  /** Smoothed level per point, dBFS: the mic alone and as heard (after the effects). −200 where nothing was heard yet. */
  rawDb: Float32Array
  processedDb: Float32Array
  /** Steady tones found so far, strongest (overDb) first, at most MAX_TONES. */
  tones: readonly SpectrumTone[]
}

export interface SpectrumAnalyzer {
  /** One stream frame (~100 ms of aligned raw and processed audio). */
  push(frame: AudioFrame): void
  /** The latest spectrum; the same arrays may be reused between calls (copy what must be kept). */
  read(): LiveSpectrum
  /** Forget everything (engine stopped / started, a state load). */
  reset(): void
}

/** One ReaEQ band as the plot shows it. `n`: 1-based band number (the `band<n>.*` keys of the chain slot). */
export interface EqPoint {
  n: number
  type: 'Low Shelf' | 'High Shelf' | 'Band' | 'Other'
  on: boolean
  freqHz: number
  gainDb: number
  bwOct: number
}

/** The values of one band a tone cut sets (keys `band<n>.freqHz` / `.gainDb` / `.bwOct`; `.on` → 1 when it was off). */
export interface NotchPlan {
  n: number
  freqHz: number
  gainDb: number
  bwOct: number
  /** The band was disabled and must be switched on. */
  enable: boolean
}
