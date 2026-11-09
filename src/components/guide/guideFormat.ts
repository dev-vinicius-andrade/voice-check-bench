// Value formatting and numbered actions for the guide steps. Values are what people type into the plugins.
import { fmtInput, fmtInputSigned } from '../../i18n/format'
import type { Callout } from './replicas/types'

/** One numbered instruction; `target` puts the same number on that control of the replica. */
export interface StepAction {
  text: string
  target?: string
}

/** Whole numbers without decimals, others with one. */
export const num = (v: number): string => fmtInput(v, Number.isInteger(v) ? 0 : 1)
export const db = (v: number): string => `${num(v)} dB`
export const signedDb = (v: number): string => `${fmtInputSigned(v, 1)} dB`
export const ms = (v: number): string => `${num(v)} ms`
/** Whole hertz, no thousands separator (people type it into a Frequency (Hz) field). */
export const hz = (v: number): string => `${Math.round(v)} Hz`
export const oct = (v: number): string => fmtInput(v, 2)

/** Callouts for the actions that point at a control: the marker number is the action's position. */
export const calloutsOf = (actions: readonly StepAction[]): Callout[] =>
  actions.flatMap((a, i) => (a.target ? [{ n: i + 1, target: a.target }] : []))
