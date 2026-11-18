// What the person wants from "Tune from a recording" (SPEC "Tune from a recording — screen", step 2), remembered in
// localStorage ('vcb-autotune-goals') through readPref/writePref: blocked storage or a broken value = the defaults.
// Framework-free.
import { AMOUNTS } from '../advice/prefs'
import { readPref, writePref } from '../../storage/prefs'
import type { VoiceStyle } from '../../types'
import type { Bother, TuneGoals, TuneUse } from '../tune'

export const USES: readonly TuneUse[] = ['streaming', 'calls', 'recording']
export const TUNE_STYLES: readonly VoiceStyle[] = ['natural', 'warm', 'clear', 'bright']
/** In the order the screen offers them. */
export const BOTHERS: readonly Bother[] = ['roomNoise', 'boomy', 'muffled', 'thin', 'harsh', 'sharpS', 'dull', 'tooQuiet', 'unevenVolume']

export const DEFAULT_TUNE_GOALS: Readonly<TuneGoals> = { use: 'streaming', style: 'natural', bothers: [], amount: 'medium' }

export const AUTOTUNE_GOALS_KEY = 'vcb-autotune-goals'

/** Known values kept, anything else → that field's default; bothers deduplicated, in BOTHERS order. */
export function parseTuneGoals(v: unknown): TuneGoals {
  const o = typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  const list = Array.isArray(o.bothers) ? o.bothers : []
  const d = DEFAULT_TUNE_GOALS
  return {
    use: USES.find((u) => u === o.use) ?? d.use,
    style: TUNE_STYLES.find((s) => s === o.style) ?? d.style,
    bothers: BOTHERS.filter((b) => list.includes(b)),
    amount: AMOUNTS.find((a) => a === o.amount) ?? d.amount,
  }
}

export const loadTuneGoals = (): TuneGoals => parseTuneGoals(readPref<unknown>(AUTOTUNE_GOALS_KEY, null))

export const saveTuneGoals = (g: TuneGoals): void => writePref(AUTOTUNE_GOALS_KEY, g)

/** Adds or removes one bother, keeping BOTHERS order. */
export const toggleBother = (list: readonly Bother[], b: Bother): Bother[] =>
  BOTHERS.filter((x) => (x === b ? !list.includes(b) : list.includes(x)))
