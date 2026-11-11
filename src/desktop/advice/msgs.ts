// Msg builders for desktop.advice.* (src/i18n/locales/{en,pt-BR}/desktop.json). Plugin names and plugin field labels
// (Wet, Dry, Threshold, Band, Low Shelf…) travel as params and stay English; numbers travel as params.
import type { Msg } from '../../plain/types'
import { canonicalName } from '../../wavelink/plugins'
import type { Advice, AdviceReason, ChainSlot, Change } from './types'

const msg = (key: string, params?: Msg['params']): Msg => (params ? { key: `desktop.advice.${key}`, params } : { key: `desktop.advice.${key}` })

/** Plain explanation of an advice: desktop.advice.title.<key>. */
export const titleMsg = (key: string, params?: Msg['params']): Msg => msg(`title.${key}`, params)

/** Exact change line of a value in dB: "ReaGate Dry 0 → −20 dB". `field` is the plugin window's label. */
export const dbChangeMsg = (slot: ChainSlot, field: string, from: number, to: number): Msg =>
  msg('change.db', { plugin: canonicalName(slot.name), field, from, to })

/** Exact change line of a ReaEQ band gain: "ReaEQ Band 3500 Hz 0 → −2 dB". */
export const eqChangeMsg = (slot: ChainSlot, type: string, freq: number, from: number, to: number): Msg =>
  msg('change.eq', { plugin: canonicalName(slot.name), type, freq, from, to })

/** Exact change line of the Noise Removal strength (0..100). */
export const strengthChangeMsg = (slot: ChainSlot, from: number, to: number): Msg => msg('change.strength', { plugin: canonicalName(slot.name), from, to })

/** Title of an inverse change (undo.ts). */
export const undoMsg = (): Msg => msg('undo')

/** A value advice for a slot: id `<reason>:<slot>:<key>`. */
export function valueAdvice(reason: AdviceReason, slot: ChainSlot, key: string, to: number, title: Msg, changeMsg: Msg): Advice {
  return { id: `${reason}:${slot.index}:${key}`, reason, kind: 'value', slot: slot.index, key, from: slot.values[key], to, titleMsg: title, changeMsg }
}

/** (slot, key) a change addresses; a switch uses the key `on`. */
export const changeTarget = (c: Change): string => `${c.slot}:${c.kind === 'switch' ? 'on' : c.key}`
