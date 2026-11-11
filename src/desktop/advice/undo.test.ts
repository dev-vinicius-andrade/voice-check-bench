import { describe, expect, it } from 'vitest'
import { slotAt, withChange } from './chain'
import { chain } from './testFixtures'
import type { Change, ChainSlot, SwitchChange, ValueChange } from './types'
import { apply, emptyUndo, setChain, undo, type UndoState } from './undo'

const title = { key: 'desktop.advice.title.tooLoud' }
const set = (slot: number, key: string, from: number, to: number, id = `tooLoud:${slot}:${key}`): ValueChange => ({ id, reason: 'tooLoud', titleMsg: title, kind: 'value', slot, key, from, to })
const sw = (slot: number, on: boolean): SwitchChange => ({ id: `x:${slot}:on`, reason: 'tone', titleMsg: title, kind: 'switch', slot, on })
const val = (s: UndoState | readonly ChainSlot[], slot: number, key: string): number | undefined =>
  slotAt('chain' in s ? s.chain : s, slot)?.values[key]

function applied(state: UndoState, c: Change): { state: UndoState; id: string; inverse: Change } {
  const r = apply(state, c)
  if (!r.ok) throw new Error(r.error)
  return { state: r.state, id: r.applied.id, inverse: r.inverse }
}

describe('undo stack', () => {
  it('apply changes the known chain and returns the inverse; undo puts it back', () => {
    const s0 = emptyUndo(chain())
    const { state, id, inverse } = applied(s0, set(3, 'wetDb', 6, 2))
    expect(val(state, 3, 'wetDb')).toBe(2)
    expect(val(s0, 3, 'wetDb')).toBe(6) // pure: the old state is untouched
    expect(inverse).toMatchObject({ kind: 'value', slot: 3, key: 'wetDb', from: 2, to: 6, reason: 'undo', titleMsg: { key: 'desktop.advice.undo' } })
    const u = undo(state, id)
    if (!u.ok) throw new Error(u.error)
    expect(u.revert).toEqual(inverse)
    expect(val(u.state, 3, 'wetDb')).toBe(6)
    expect(u.state.applied).toEqual([])
  })

  it('the inverse restores the actual value, not the stale `from` of the advice', () => {
    const { inverse } = applied(emptyUndo(chain()), set(3, 'wetDb', 12, 2))
    expect(inverse).toMatchObject({ from: 2, to: 6 })
  })

  it('undoes in any order when the changes touch different values', () => {
    let s = emptyUndo(chain())
    const a = applied(s, set(1, 'dryDb', -20, -10))
    const b = applied(a.state, set(3, 'wetDb', 6, 9))
    s = b.state
    const ua = undo(s, a.id) // the first one, not the last
    if (!ua.ok) throw new Error(ua.error)
    expect(val(ua.state, 1, 'dryDb')).toBe(-20)
    expect(val(ua.state, 3, 'wetDb')).toBe(9)
    expect(ua.state.applied.map((x) => x.id)).toEqual([b.id])
    const ub = undo(ua.state, b.id)
    if (!ub.ok) throw new Error(ub.error)
    expect(val(ub.state, 3, 'wetDb')).toBe(6)
  })

  it('conflict when the value changed since (a slider): nothing changes', () => {
    const a = applied(emptyUndo(chain()), set(3, 'wetDb', 6, 2))
    const moved = setChain(a.state, withChange(a.state.chain, set(3, 'wetDb', 2, 4)))
    expect(undo(moved, a.id)).toEqual({ ok: false, error: 'conflict', expected: 2, current: 4 })
    expect(moved.applied).toHaveLength(1)
  })

  it('conflict when a later change moved the same value; undoing the later one first works', () => {
    const a = applied(emptyUndo(chain()), set(3, 'wetDb', 6, 4))
    const b = applied(a.state, set(3, 'wetDb', 4, 2))
    expect(undo(b.state, a.id)).toMatchObject({ ok: false, error: 'conflict', expected: 4, current: 2 })
    const ub = undo(b.state, b.id)
    if (!ub.ok) throw new Error(ub.error)
    const ua = undo(ub.state, a.id)
    if (!ua.ok) throw new Error(ua.error)
    expect(val(ua.state, 3, 'wetDb')).toBe(6)
  })

  it('a value equal within float32 rounding is not a conflict', () => {
    const a = applied(emptyUndo(chain()), set(3, 'wetDb', 6, 2))
    const engine = setChain(a.state, withChange(a.state.chain, set(3, 'wetDb', 2, 2.0000004)))
    expect(undo(engine, a.id).ok).toBe(true)
  })

  it('the same advice applied twice gets two ids', () => {
    const a = applied(emptyUndo(chain()), set(3, 'wetDb', 6, 4))
    const b = applied(a.state, set(3, 'wetDb', 4, 2))
    expect(a.id).not.toBe(b.id)
  })

  it('switch changes: apply and undo', () => {
    const a = applied(emptyUndo(chain()), sw(0, false))
    expect(slotAt(a.state.chain, 0)?.on).toBe(false)
    expect(a.inverse).toMatchObject({ kind: 'switch', on: true })
    const u = undo(a.state, a.id)
    if (!u.ok) throw new Error(u.error)
    expect(slotAt(u.state.chain, 0)?.on).toBe(true)
  })

  it('switch conflict when switched again since', () => {
    const a = applied(emptyUndo(chain()), sw(0, false))
    const back = setChain(a.state, withChange(a.state.chain, sw(0, true)))
    expect(undo(back, a.id)).toEqual({ ok: false, error: 'conflict', expected: false, current: true })
  })

  it('unknown id (never applied or already undone) and missing slots', () => {
    const a = applied(emptyUndo(chain()), set(3, 'wetDb', 6, 2))
    expect(undo(a.state, 'nope')).toEqual({ ok: false, error: 'unknown' })
    const u = undo(a.state, a.id)
    if (!u.ok) throw new Error(u.error)
    expect(undo(u.state, a.id)).toEqual({ ok: false, error: 'unknown' })
    expect(apply(emptyUndo(chain()), set(42, 'wetDb', 0, 1))).toEqual({ ok: false, error: 'missing' })
    expect(apply(emptyUndo(chain()), set(3, 'nope', 0, 1))).toEqual({ ok: false, error: 'missing' })
    const gone = setChain(a.state, a.state.chain.filter((s) => s.index !== 3))
    expect(undo(gone, a.id)).toEqual({ ok: false, error: 'missing' })
  })
})
