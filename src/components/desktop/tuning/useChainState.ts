import { useCallback, useEffect, useRef, useState } from 'react'
import { sameValue, slotAt, withChange } from '../../../desktop/advice/chain'
import type { Advice, Change, ValueChange } from '../../../desktop/advice/types'
import { apply, setChain, undo } from '../../../desktop/advice/undo'
import type { DesktopBridge } from '../../../desktop/bridge'
import { changeLineMsg } from '../../../desktop/changeMsg'
import { engineOp } from '../../../desktop/slots'
import type { AudioSlot, AudioStatus, WlSnapshot } from '../../../desktop/types'
import type { Msg } from '../../../plain/types'
import { batchOn, edit, modelOf, opOf, savedModel, switchEdit, withSlot, type AppliedRow, type BatchOp, type ChainModel } from './chainModel'
import { useEngineOps } from './useEngineOps'

export type { AppliedRow, BatchOp, ChainModel } from './chainModel'

export interface ChainState {
  model: ChainModel | null
  applied: readonly AppliedRow[]
  /** Clock time of the last change (advice waits for speech heard after it). */
  lastChangeMs: number | undefined
  notice: Msg | null
  clearNotice(): void
  load(status: AudioStatus, snapshot: WlSnapshot | null): void
  /** After a save: the file as it is now becomes the start point. */
  saved(snapshot: WlSnapshot): void
  /** While dragging: sent to the engine at most 20 times per second. */
  preview(slot: number, key: string, value: number): void
  /** Slider released: the value is final, a marker and a new segment. */
  commit(slot: number, key: string, value: number): void
  setOn(slot: number, on: boolean): void
  /** The applied id, or null when the change could not be applied (a notice says why). */
  applyAdvice(a: Advice): string | null
  undoApplied(appliedId: string): void
  /** Several changes at once, in order (the noise calibration); per op the entry's id, or null when it was not done. */
  applyBatch(batch: readonly BatchOp[]): (string | null)[]
}

/** The live chain: slider edits (throttled), switches, "Try this" with its Undo, all sent to the engine. */
export function useChainState(bridge: DesktopBridge, markChange: (m: Msg) => void, nowMs: () => number): ChainState {
  const [model, setModel] = useState<ChainModel | null>(null)
  const [applied, setApplied] = useState<readonly AppliedRow[]>([])
  const [lastChangeMs, setLastChange] = useState<number | undefined>(undefined)
  const [notice, setNotice] = useState<Msg | null>(null)
  const onSlot = useCallback((s: AudioSlot) => setModel((m) => withSlot(m, s)), [])
  const { run, throttled } = useEngineOps(bridge, onSlot, setNotice)

  /** Marker + segment labelled with the change line, and the advice clock. */
  const changed = (m: ChainModel, c: Change, label?: Msg): void => {
    const s = slotAt(m.undo.chain, c.slot)
    const msg = label ?? (s ? changeLineMsg(s, c) : null)
    if (msg) markChange(msg)
    setLastChange(nowMs())
  }

  // a batch or a commit may come from a stream frame before the last one rendered: it builds on what the last one left
  const latest = useRef({ model, applied })
  useEffect(() => {
    latest.current = { model, applied }
  }, [model, applied])

  /**
   * Values being dragged and not released yet, per slot: a preview of one key carries the others (a ReaEQ handle moves
   * frequency and gain at once, and its engine command is the whole band state).
   */
  const pending = useRef(new Map<number, Record<string, number>>())

  const load = useCallback((status: AudioStatus, snap: WlSnapshot | null) => {
    pending.current.clear()
    setModel(modelOf(status, snap))
    setApplied([])
    setLastChange(undefined)
  }, [])

  /** The engine command of `c` on the latest chain plus the slot's pending values, and the throttle it goes through. */
  const sendOf = (m: ChainModel, c: ValueChange) => {
    const s = slotAt(m.undo.chain, c.slot)
    const extra = pending.current.get(c.slot)
    const base = s && extra ? { ...m, undo: setChain(m.undo, m.undo.chain.map((x) => (x === s ? { ...s, values: { ...s.values, ...extra } } : x))) } : m
    const op = opOf(base, c)
    // a whole-state command (ReaEQ) has one throttle per slot, so its keys never race each other
    return { op, t: throttled(op?.op === 'state' ? `${c.slot}:state` : `${c.slot}:${c.key}`) }
  }

  const preview = (slot: number, key: string, value: number): void => {
    const m = latest.current.model
    const s = m && slotAt(m.undo.chain, slot)
    if (!m || !s) return
    pending.current.set(slot, { ...pending.current.get(slot), [key]: value })
    const { op, t } = sendOf(m, edit(slot, key, s.values[key], value))
    if (op) t.push(op)
  }

  /** Builds on the latest chain, so several commits in one event (a ReaEQ handle released) add up. */
  const commit = (slot: number, key: string, value: number): void => {
    const m = latest.current.model
    const s = m && slotAt(m.undo.chain, slot)
    if (!m || !s) return
    const rest = { ...pending.current.get(slot) }
    delete rest[key]
    if (Object.keys(rest).length) pending.current.set(slot, rest)
    else pending.current.delete(slot)
    const c = edit(slot, key, s.values[key], value)
    const { op, t } = sendOf(m, c)
    if (op) t.push(op)
    t.flush()
    if (sameValue(c.from, c.to)) return
    const next = { ...m, undo: setChain(m.undo, withChange(m.undo.chain, c)) }
    latest.current = { ...latest.current, model: next }
    setModel((cur) => (cur ? { ...cur, undo: setChain(cur.undo, withChange(cur.undo.chain, c)) } : cur))
    changed(m, c)
  }

  const setOn = (slot: number, on: boolean): void => {
    if (!model) return
    const c = switchEdit(slot, on)
    setModel({ ...model, undo: setChain(model.undo, withChange(model.undo.chain, c)) })
    void run(opOf(model, c))
    changed(model, c)
  }

  const applyAdvice = (a: Advice): string | null => {
    if (!model) return null
    const r = apply(model.undo, a)
    if (!r.ok) {
      setNotice({ key: 'desktop.advice.missing' })
      return null
    }
    setModel({ ...model, undo: r.state })
    setApplied((list) => [...list, { appliedId: r.applied.id, advice: a }])
    void run(engineOp(a, r.state.chain, model.slots, model.entries))
    changed(model, a, a.changeMsg)
    return r.applied.id
  }

  const undoApplied = (appliedId: string): void => {
    if (!model) return
    const r = undo(model.undo, appliedId)
    if (!r.ok) return setNotice({ key: r.error === 'conflict' ? 'desktop.advice.conflict' : 'desktop.advice.missing' })
    setModel({ ...model, undo: r.state })
    setApplied((list) => list.filter((x) => x.appliedId !== appliedId))
    void run(engineOp(r.revert, r.state.chain, model.slots, model.entries))
    changed(model, r.revert)
  }

  const applyBatch = (batch: readonly BatchOp[]): (string | null)[] => {
    const now = latest.current
    if (!now.model) return batch.map(() => null)
    const r = batchOn(now.model, now.applied, batch)
    latest.current = { model: r.model, applied: r.applied }
    setModel(r.model)
    setApplied(r.applied)
    if (r.notice) setNotice(r.notice)
    r.ops.forEach((op) => void run(op))
    r.changes.forEach(({ change, label }) => changed(r.model, change, label))
    return r.ids
  }

  const saved = (snap: WlSnapshot): void => setModel((m) => savedModel(m, snap))

  return { model, applied, lastChangeMs, notice, clearNotice: () => setNotice(null), load, saved, preview, commit, setOn, applyAdvice, undoApplied, applyBatch }
}
