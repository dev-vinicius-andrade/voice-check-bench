import { useCallback, useState } from 'react'
import { sameValue, slotAt, withChange } from '../../../desktop/advice/chain'
import type { Advice, Change } from '../../../desktop/advice/types'
import { apply, setChain, undo } from '../../../desktop/advice/undo'
import type { DesktopBridge } from '../../../desktop/bridge'
import { changeLineMsg } from '../../../desktop/changeMsg'
import { engineOp } from '../../../desktop/slots'
import type { AudioSlot, AudioStatus, WlSnapshot } from '../../../desktop/types'
import type { Msg } from '../../../plain/types'
import { edit, modelOf, opOf, savedModel, switchEdit, withSlot, type AppliedRow, type ChainModel } from './chainModel'
import { useEngineOps } from './useEngineOps'

export type { AppliedRow, ChainModel } from './chainModel'

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

  const load = useCallback((status: AudioStatus, snap: WlSnapshot | null) => {
    setModel(modelOf(status, snap))
    setApplied([])
    setLastChange(undefined)
  }, [])

  const preview = (slot: number, key: string, value: number): void => {
    const s = model && slotAt(model.undo.chain, slot)
    const op = s && opOf(model, edit(slot, key, s.values[key], value))
    if (op) throttled(`${slot}:${key}`).push(op)
  }

  const commit = (slot: number, key: string, value: number): void => {
    const s = model && slotAt(model.undo.chain, slot)
    if (!model || !s) return
    const c = edit(slot, key, s.values[key], value)
    const t = throttled(`${slot}:${key}`)
    const op = opOf(model, c)
    if (op) t.push(op)
    t.flush()
    if (sameValue(c.from, c.to)) return
    setModel({ ...model, undo: setChain(model.undo, withChange(model.undo.chain, c)) })
    changed(model, c)
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

  const saved = (snap: WlSnapshot): void => setModel((m) => savedModel(m, snap))

  return { model, applied, lastChangeMs, notice, clearNotice: () => setNotice(null), load, saved, preview, commit, setOn, applyAdvice, undoApplied }
}
