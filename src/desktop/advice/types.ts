// "Try this" advice contract (SPEC "Desktop app (v2.0)" → Tuning; PLAN task 42). Framework-free: no React, no Tauri.
// The live chain is described in real units, independent of the Rust bridge: the UI maps the engine's slots (or a
// decoded Wave Link file) into ChainSlot values. Units are those of src/wavelink decoding (fxp.ts): dB, ms, Hz, octaves.
import type { Msg } from '../../plain/types'

/** What a slot is. ReaFIR, De-Esser, Elgato EQ, Wave Link built-ins and anything else only carry on/off here. */
export type SlotKind = 'reagate' | 'reacomp' | 'reaeq' | 'reafir' | 'noiseRemoval' | 'deesser' | 'elgatoEq' | 'builtin' | 'other'

/** ReaGate value keys: Threshold (dB), Hold (ms), Release (ms), Wet (dB), Dry (dB). Wet −100 dB = gate off. */
export type GateKey = 'thresholdDb' | 'holdMs' | 'releaseMs' | 'wetDb' | 'dryDb'
/** ReaComp value keys: Threshold (dB), Ratio (x:1, 1..100), Attack (ms), Release (ms), Wet (dB, the make-up gain). */
export type CompKey = 'thresholdDb' | 'ratio' | 'attackMs' | 'releaseMs' | 'wetDb'
/** Elgato Noise Removal: `strength` 0..100 = the plugin's VAD Threshold × 100 (default 0.85 → 85). */
export type NoiseRemovalKey = 'strength'
/**
 * ReaEQ value keys, one group per band in plugin order, n = 1-based band number (as "Band 2 Gain (dB)" in the
 * plugin window): `band<n>.type` (ReaEQ type code, EQ_TYPES: 0 Low Shelf, 1 High Shelf, 8 Band; anything else is
 * another type), `band<n>.on` (1 enabled, 0 disabled), `band<n>.freqHz`, `band<n>.gainDb`, `band<n>.bwOct`.
 * Build and read them with eqKey() / eqBands() (./chain.ts).
 */
export type EqField = 'type' | 'on' | 'freqHz' | 'gainDb' | 'bwOct'
export type EqKey = `band${number}.${EqField}`

/** One effect of the live chain, in Wave Link order. */
export interface ChainSlot {
  /** Position in the Wave Link chain (AudioPluginConfigurations index); changes address the slot by it. */
  index: number
  kind: SlotKind
  /** Plugin name as Wave Link lists it ("ReaGate (ReaPlugs Edition)"); shown shortened by canonicalName(). */
  name: string
  /** Switched on (Wave Link BypassState false and the plugin's own bypass off). */
  on: boolean
  /** Current values by key (GateKey / CompKey / EqKey / NoiseRemovalKey per kind); missing keys are never advised. */
  values: Record<string, number>
}

/** Why an advice is given (most important first in advise()'s output order). */
export type AdviceReason = 'gateDoubled' | 'tooLoud' | 'deadSilence' | 'tooQuiet' | 'tone'

interface ChangeBase {
  /** Stable for the same advice: `<reason>:<slot>:<key>` (`<reason>:<slot>:on` for a switch). */
  id: string
  reason: AdviceReason | 'undo'
  /** Plain explanation (desktop.advice.title.* / desktop.advice.undo). */
  titleMsg: Msg
  /** ChainSlot.index of the slot it changes. */
  slot: number
}

/** Set one value of a slot. */
export interface ValueChange extends ChangeBase {
  kind: 'value'
  key: string
  from: number
  to: number
}

/** Switch a slot on or off. */
export interface SwitchChange extends ChangeBase {
  kind: 'switch'
  on: boolean
}

export type Change = ValueChange | SwitchChange

/** One "Try this" row: the change plus the exact change line ("ReaGate Dry 0 → −20 dB", desktop.advice.change.*). */
export type Advice = Change & { reason: AdviceReason; changeMsg: Msg }
