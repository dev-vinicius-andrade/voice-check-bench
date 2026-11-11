// The live chain model of the tuning screen and pure helpers over it (no React).
import { withChange } from '../../../desktop/advice/chain'
import type { Advice, ChainSlot, Change, SwitchChange, ValueChange } from '../../../desktop/advice/types'
import { emptyUndo, type UndoState } from '../../../desktop/advice/undo'
import { chainOf, engineOp, type EngineOp } from '../../../desktop/slots'
import type { AudioSlot, AudioStatus, WlChainEntry, WlSnapshot } from '../../../desktop/types'

/** The live chain with what it started from (for the export) and the Wave Link entries it was read from. */
export interface ChainModel {
  undo: UndoState
  /** Chain as read at Start or at the last save. */
  start: readonly ChainSlot[]
  slots: readonly AudioSlot[]
  /** The input's Wave Link entries; null when Settings.json could not be read. */
  entries: readonly WlChainEntry[] | null
  inputKey: string | null
  hash: string | null
}

export interface AppliedRow {
  appliedId: string
  advice: Advice
}

const manual = { reason: 'undo', titleMsg: { key: 'desktop.advice.undo' } } as const

/** A value moved by hand (slider). */
export const edit = (slot: number, key: string, from: number, to: number): ValueChange => ({ ...manual, id: `edit:${slot}:${key}`, kind: 'value', slot, key, from, to })

/** A slot switched by hand. */
export const switchEdit = (slot: number, on: boolean): SwitchChange => ({ ...manual, id: `edit:${slot}:on`, kind: 'switch', slot, on })

/** The model of a freshly started engine; `snap` is Settings.json as read right after Start (null when unreadable). */
export function modelOf(status: AudioStatus, snap: WlSnapshot | null): ChainModel {
  const input = snap?.inputs.find((i) => i.key === status.source?.inputKey) ?? null
  const chain = chainOf(status.slots, input?.entries ?? null)
  return { undo: emptyUndo(chain), start: chain, slots: status.slots, entries: input?.entries ?? null, inputKey: input?.key ?? null, hash: snap?.hash ?? null }
}

/** After a save: the file as it is now is the new start point. */
export function savedModel(m: ChainModel | null, snap: WlSnapshot): ChainModel | null {
  const input = m && snap.inputs.find((i) => i.key === m.inputKey)
  return m && input ? { ...m, start: m.undo.chain, entries: input.entries, hash: snap.hash } : m
}

/** The engine command for a change on the model's current chain. */
export const opOf = (m: ChainModel, c: Change): EngineOp | null => engineOp(c, withChange(m.undo.chain, c), m.slots, m.entries)

/** The model with an engine reply (the slot as it is now). */
export const withSlot = (m: ChainModel | null, s: AudioSlot): ChainModel | null => (m ? { ...m, slots: m.slots.map((x) => (x.index === s.index ? s : x)) } : m)
