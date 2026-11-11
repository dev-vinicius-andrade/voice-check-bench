// Slider ranges of the plugin cards (SPEC "Desktop app (v2.0)" → Tuning), in the units of the advice chain. Ranges are
// those the Wave Link tool accepts for each value (validateSuggestion in src/wavelink/plugins.ts); frequency and ratio
// move on a log scale. Framework-free.
import { eqBands, eqKey } from './advice/chain'
import type { ChainSlot, SlotKind } from './advice/types'
import { FIELD_LABELS } from './changeMsg'

export type SliderUnit = 'dB' | 'ms' | 'ratio' | 'Hz' | 'strength'

export interface SliderSpec {
  key: string
  /** Plugin window label (never translated); null = the card names it (Noise Removal strength). */
  label: string | null
  unit: SliderUnit
  min: number
  max: number
  step: number
  /** Moves on log10 of the value. */
  log?: boolean
}

const db = (key: string, min: number, max: number): SliderSpec => ({ key, label: FIELD_LABELS[key], unit: 'dB', min, max, step: 0.5 })
const ms = (key: string, max: number, step: number): SliderSpec => ({ key, label: FIELD_LABELS[key], unit: 'ms', min: 0, max, step })

const SPECS: Partial<Record<SlotKind, readonly SliderSpec[]>> = {
  reagate: [db('thresholdDb', -100, 0), ms('holdMs', 1000, 1), ms('releaseMs', 5000, 1), db('wetDb', -100, 24), db('dryDb', -100, 24)],
  reacomp: [
    db('thresholdDb', -100, 0),
    { key: 'ratio', label: FIELD_LABELS.ratio, unit: 'ratio', min: 1, max: 100, step: 0.1, log: true },
    ms('attackMs', 500, 0.1),
    ms('releaseMs', 5000, 1),
    db('wetDb', -100, 24),
  ],
  noiseRemoval: [{ key: 'strength', label: null, unit: 'strength', min: 0, max: 100, step: 1 }],
}

/** ReaEQ band n: gain, then frequency. */
export const eqSliders = (n: number): [SliderSpec, SliderSpec] => [
  { key: eqKey(n, 'gainDb'), label: 'Gain', unit: 'dB', min: -40, max: 40, step: 0.5 },
  { key: eqKey(n, 'freqHz'), label: 'Frequency', unit: 'Hz', min: 20, max: 20000, step: 1, log: true },
]

/** Sliders of a slot whose value exists (ReaEQ: every band's gain and frequency). */
export function slidersOf(slot: ChainSlot): SliderSpec[] {
  if (slot.kind === 'reaeq') return eqBands(slot).flatMap((b) => eqSliders(b.n))
  return (SPECS[slot.kind] ?? []).filter((s) => Number.isFinite(slot.values[s.key]))
}

/** Value → slider position, and back (rounded to the step). */
export const toPos = (s: SliderSpec, v: number): number => (s.log ? Math.log10(Math.max(s.min, v)) : v)
export function fromPos(s: SliderSpec, pos: number): number {
  const v = s.log ? 10 ** pos : pos
  const r = Math.round(v / s.step) * s.step
  return Math.min(s.max, Math.max(s.min, Number(r.toFixed(3))))
}
