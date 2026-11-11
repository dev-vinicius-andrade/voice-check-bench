// "Your sound" tuning preferences of the desktop app (SPEC "Desktop app (v2.0)" → Tuning): how much processing the
// advice may add per change, and how hard it fights background noise. Framework-free; stored in localStorage
// ('vcb-tuning-prefs') through readPref/writePref, so blocked storage just means the defaults.
import { TONE_MAX_DB } from '../../live/hints'
import { readPref, writePref } from '../../storage/prefs'

export type ProcessingAmount = 'light' | 'medium' | 'strong'
export type NoiseMode = 'natural' | 'max'

export interface TuningPrefs {
  /** Biggest single EQ move an advice may suggest (AMOUNT_STEP_DB). */
  amount: ProcessingAmount
  /** natural: pauses quiet, never dead (dead-silence advice); max: remove as much noise as possible (noisy-pause advice). */
  noise: NoiseMode
}

export const AMOUNTS: readonly ProcessingAmount[] = ['light', 'medium', 'strong']
export const NOISE_MODES: readonly NoiseMode[] = ['natural', 'max']

export const DEFAULT_TUNING_PREFS: Readonly<TuningPrefs> = { amount: 'medium', noise: 'natural' }

/** Largest EQ step per tone advice, dB; strong is the live hints' cap (TONE_MAX_DB). */
export const AMOUNT_STEP_DB: Readonly<Record<ProcessingAmount, number>> = { light: 2, medium: 4, strong: TONE_MAX_DB }

export const TUNING_PREFS_KEY = 'vcb-tuning-prefs'

/** Known values kept, anything else (missing, wrong type, unknown string) → the default of that field. */
export function parseTuningPrefs(v: unknown): TuningPrefs {
  const o = typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  return {
    amount: AMOUNTS.find((a) => a === o.amount) ?? DEFAULT_TUNING_PREFS.amount,
    noise: NOISE_MODES.find((n) => n === o.noise) ?? DEFAULT_TUNING_PREFS.noise,
  }
}

export const loadTuningPrefs = (): TuningPrefs => parseTuningPrefs(readPref<unknown>(TUNING_PREFS_KEY, null))

export const saveTuningPrefs = (p: TuningPrefs): void => writePref(TUNING_PREFS_KEY, p)
