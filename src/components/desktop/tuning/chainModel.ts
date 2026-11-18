// The live chain model of the tuning screen and pure helpers over it (no React).
import { withChange } from '../../../desktop/advice/chain'
import type { Advice, ChainSlot, Change, SwitchChange, ValueChange } from '../../../desktop/advice/types'
import type { Msg } from '../../../plain/types'
import { apply, emptyUndo, retarget, undo, type UndoState } from '../../../desktop/advice/undo'
import { engineOp, ownBypassedSlots, playedChain, type EngineOp } from '../../../desktop/slots'
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
  /** Slots Wave Link lists as on whose plugin sits on its own bypass (off here until switched on; Save: exportPlan asListed). */
  ownBypassed: readonly number[]
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

/**
 * The model of a freshly started engine; `snap` is Settings.json as read right after Start (null when unreadable). The
 * chain is the one the engine plays: a plugin on its own bypass is off (playedChain).
 */
export function modelOf(status: AudioStatus, snap: WlSnapshot | null): ChainModel {
  const input = snap?.inputs.find((i) => i.key === status.source?.inputKey) ?? null
  const chain = playedChain(status.slots, input?.entries ?? null)
  return { undo: emptyUndo(chain), start: chain, slots: status.slots, entries: input?.entries ?? null, inputKey: input?.key ?? null, hash: snap?.hash ?? null, ownBypassed: ownBypassedSlots(status.slots) }
}

/** After a save: the file as it is now is the new start point (a slot saved switched on is off its own bypass there). */
export function savedModel(m: ChainModel | null, snap: WlSnapshot): ChainModel | null {
  const input = m && snap.inputs.find((i) => i.key === m.inputKey)
  if (!m || !input) return m
  const ownBypassed = m.ownBypassed.filter((i) => !m.undo.chain.some((s) => s.index === i && s.on))
  return { ...m, start: m.undo.chain, entries: input.entries, hash: snap.hash, ownBypassed }
}

/** The engine command for a change on the model's current chain. */
export const opOf = (m: ChainModel, c: Change): EngineOp | null => engineOp(c, withChange(m.undo.chain, c), m.slots, m.entries)

/** The model with an engine reply (the slot as it is now). */
export const withSlot = (m: ChainModel | null, s: AudioSlot): ChainModel | null => (m ? { ...m, slots: m.slots.map((x) => (x.index === s.index ? s : x)) } : m)

/**
 * One step of a batch of changes made together (the noise calibration's): a new entry, an entry moved on (a new one
 * when it is gone or its value was changed since), an entry undone.
 */
export type BatchOp = { op: 'apply'; advice: Advice } | { op: 'retarget'; appliedId: string; advice: Advice & ValueChange } | { op: 'undo'; appliedId: string }

export interface BatchResult {
  model: ChainModel
  applied: AppliedRow[]
  /** Per op: the entry's id (apply / retarget: possibly a new one), or null when it could not be done (undo: the id it removed). */
  ids: (string | null)[]
  /** Engine commands, in order. */
  ops: EngineOp[]
  /** What changed, for the history markers (the change line). */
  changes: { change: Change; label?: Msg }[]
  /** Why an undo could not be done (the value was changed since), if one could not. */
  notice: Msg | null
}

/** A batch of changes on the model, one after the other (pure): the state, the engine commands and the markers. */
export function batchOn(m0: ChainModel, applied0: readonly AppliedRow[], batch: readonly BatchOp[]): BatchResult {
  let m = m0
  let applied = [...applied0]
  const out: BatchResult = { model: m, applied, ids: [], ops: [], changes: [], notice: null }
  const done = (c: Change, id: string, label?: Msg): void => {
    const op = engineOp(c, m.undo.chain, m.slots, m.entries)
    if (op) out.ops.push(op)
    out.changes.push({ change: c, label })
    out.ids.push(id)
  }
  const add = (a: Advice): void => {
    const r = apply(m.undo, a)
    if (!r.ok) return void out.ids.push(null)
    m = { ...m, undo: r.state }
    applied = [...applied, { appliedId: r.applied.id, advice: a }]
    done(a, r.applied.id, a.changeMsg)
  }
  for (const b of batch) {
    if (b.op === 'apply') add(b.advice)
    else if (b.op === 'retarget') {
      const r = retarget(m.undo, b.appliedId, b.advice)
      if (!r.ok) {
        add(b.advice)
        continue
      }
      m = { ...m, undo: r.state }
      applied = applied.map((a) => (a.appliedId === b.appliedId ? { appliedId: a.appliedId, advice: b.advice } : a))
      done(b.advice, b.appliedId, b.advice.changeMsg)
    } else {
      const r = undo(m.undo, b.appliedId)
      if (!r.ok) {
        if (r.error === 'conflict') out.notice = { key: 'desktop.advice.conflict' }
        out.ids.push(null)
        continue
      }
      m = { ...m, undo: r.state }
      applied = applied.filter((a) => a.appliedId !== b.appliedId)
      done(r.revert, b.appliedId)
    }
  }
  return { ...out, model: m, applied }
}
