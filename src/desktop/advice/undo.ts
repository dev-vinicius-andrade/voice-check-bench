// Applied-changes stack with per-change Undo (SPEC "Desktop app (v2.0)" → Tuning: "each change has its own Undo").
// Pure: every call returns a new state. The state keeps the chain values it knows; the caller sends the returned
// changes to the engine and reports other edits (sliders, a reload) with setChain(), so Undo can tell when a value
// was changed since.
import { currentOf, sameValue, withChange } from './chain'
import { undoMsg } from './msgs'
import type { ChainSlot, Change } from './types'

export interface AppliedChange {
  /** Unique in this stack: `<change id>#<n>` (the same advice can be applied again later). */
  id: string
  change: Change
  /** What puts it back: `to` is the value before the change, `from` the change's `to`. */
  inverse: Change
}

export interface UndoState {
  chain: readonly ChainSlot[]
  /** Oldest first. */
  applied: readonly AppliedChange[]
  /** Next sequence number for applied ids. */
  seq: number
}

export type ApplyResult = { ok: true; state: UndoState; applied: AppliedChange; inverse: Change } | { ok: false; error: 'missing' }

export type UndoResult =
  | { ok: true; state: UndoState; revert: Change }
  /** unknown: no applied change has this id (never applied, or already undone); missing: its slot or key is gone. */
  | { ok: false; error: 'unknown' | 'missing' }
  /** The value was changed since (a slider, or a later change on the same value): Undo would overwrite it. */
  | { ok: false; error: 'conflict'; expected: number | boolean; current: number | boolean }

export const emptyUndo = (chain: readonly ChainSlot[]): UndoState => ({ chain, applied: [], seq: 1 })

/** The chain as it is now (engine values, manual edits); the applied list is kept. */
export const setChain = (state: UndoState, chain: readonly ChainSlot[]): UndoState => ({ ...state, chain })

/** The inverse of `c` given the value before it. */
function inverseOf(c: Change, before: number | boolean): Change {
  const base = { id: `undo:${c.id}`, reason: 'undo' as const, titleMsg: undoMsg(), slot: c.slot }
  if (c.kind === 'switch') return { ...base, kind: 'switch', on: before === true }
  return { ...base, kind: 'value', key: c.key, from: c.to, to: typeof before === 'number' ? before : c.from }
}

/** Applies a change to the known chain and records it with its inverse (from the actual value, not c.from). */
export function apply(state: UndoState, c: Change): ApplyResult {
  const before = currentOf(state.chain, c)
  if (before === undefined) return { ok: false, error: 'missing' }
  const inverse = inverseOf(c, before)
  const applied: AppliedChange = { id: `${c.id}#${state.seq}`, change: c, inverse }
  return { ok: true, state: { chain: withChange(state.chain, c), applied: [...state.applied, applied], seq: state.seq + 1 }, applied, inverse }
}

/**
 * Reverts one applied change, in any order, only while its value still equals the change's `to`; otherwise a
 * conflict and nothing changes. On success the change leaves the stack and `revert` is what to send to the engine.
 */
export function undo(state: UndoState, id: string): UndoResult {
  const entry = state.applied.find((a) => a.id === id)
  if (!entry) return { ok: false, error: 'unknown' }
  const { change, inverse } = entry
  const current = currentOf(state.chain, change)
  if (current === undefined) return { ok: false, error: 'missing' }
  const expected = change.kind === 'switch' ? change.on : change.to
  const same = typeof current === 'number' && typeof expected === 'number' ? sameValue(current, expected) : current === expected
  if (!same) return { ok: false, error: 'conflict', expected, current }
  return {
    ok: true,
    state: { ...state, chain: withChange(state.chain, inverse), applied: state.applied.filter((a) => a !== entry) },
    revert: inverse,
  }
}
