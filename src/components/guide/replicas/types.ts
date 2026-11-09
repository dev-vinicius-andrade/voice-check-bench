// Contract between the guide shell (task 23) and the plugin replicas (task 24). Owned by the orchestrator.
import type { Suggestion } from '../../../types'

/** Which control a callout points at; replicas render a numbered marker on it. */
export interface Callout {
  /** 1-based number shown on the marker and in the step text. */
  n: number
  /** Replica-specific control id, e.g. 'tab-2', 'frequency', 'gain', 'bandwidth', 'type', 'threshold', 'ratio', 'mode', 'fftSize', 'buildProfile'. */
  target: string
}

export interface ReaEqPanelProps {
  eq: Suggestion['eq']
  /** 0-based band shown as the selected tab. */
  activeBand: number
  callouts?: Callout[]
}
export interface ReaCompPanelProps {
  comp: Suggestion['comp']
  callouts?: Callout[]
}
export interface ReaGatePanelProps {
  gate: Suggestion['gate']
  callouts?: Callout[]
}
export interface ReaFirPanelProps {
  /** 'profile' = the moment of ticking "Automatically build noise profile"; 'reduce' = curve lowered. */
  phase: 'setup' | 'profile' | 'reduce'
  callouts?: Callout[]
}
export interface WaveLinkEffectsProps {
  /** Plugin names in the order they must appear (e.g. Suggestion.chain). */
  chain: string[]
  /** Effects that must be switched off. */
  off: string[]
  highlight?: string
  callouts?: Callout[]
}
