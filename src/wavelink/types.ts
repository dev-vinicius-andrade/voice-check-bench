// Contract for the Wave Link Settings.json codec (task 30) used by the UI (task 31). Owned by the orchestrator.
import type { SuggestionJson } from '../settings/suggest'

export const WAVELINK_SETTINGS_PATH = '%LOCALAPPDATA%\Packages\Elgato.WaveLink_g54w8ztgkx496\LocalState\Settings.json'

/** One input (mic) found in the file. */
export interface WlInput {
  key: string
  /** Human name if available (else the key). */
  label: string
  plugins: WlPlugin[]
}

export type WlPluginState =
  | { kind: 'reagate'; threshold: number; attack: number; hold: number; release: number; hysteresis: number; wet: number; dry: number }
  | { kind: 'recomp'; threshold: number; ratio: number; attack: number; release: number; wet: number; limit: boolean }
  | { kind: 'reaeq'; bands: { type: 'Low Shelf' | 'High Shelf' | 'Band' | 'Other'; enabled: boolean; freq: number; gain: number; bw: number }[] }
  | { kind: 'opaque' } // ReaFIR, Elgato effects, anything else: kept byte-for-byte

export interface WlPlugin {
  /** Index in AudioPluginConfigurations. */
  index: number
  name: string
  vendor: string
  /** True when the effect is switched on (BypassState false). */
  on: boolean
  state: WlPluginState
  /** Raw base64 ParameterState, kept so profiles can restore it exactly (e.g. a configured ReaFIR). */
  parameterState: string
}

export interface WlFile {
  /** Original text, untouched. */
  text: string
  inputs: WlInput[]
}

export type WlChangeKind = 'value' | 'bands' | 'onOff' | 'missing' | 'restore'
export interface WlChange {
  plugin: string
  kind: WlChangeKind
  /** Field label as shown in the plugin ("Threshold", "Band 2 Gain (dB)") or '' for whole-plugin changes. */
  field: string
  from: string
  to: string
}

/** What to write: a suggestion (values), and/or exact plugin states from a profile, and effects to switch on/off. */
export interface WlApplyPlan {
  inputKey: string
  suggestion?: SuggestionJson
  /** name → base64 ParameterState to restore exactly (profiles). */
  restoreStates?: Record<string, string>
  switchOff?: string[]
  switchOn?: string[]
}

export interface WlApplyResult {
  /** New file text (formatting preserved). */
  text: string
  changes: WlChange[]
  /** Plugins the plan needs that are not on the input (must be added in Wave Link first). */
  missing: string[]
}
