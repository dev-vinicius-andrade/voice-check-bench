import { useRef, useState } from 'react'
import type { WlChainEntry } from '../../../desktop/types'
import { fitRemover, planNoiseCut, type NoiseCutAmount, type NoiseCutPlan } from '../../../desktop/autotune/noiseCut'
import { errorMsg } from '../../../desktop/errors'
import type { Msg } from '../../../plain/types'
import type { CutValue } from './noiseCutEdits'
import type { ManualEq } from './useManualEq'
import type { TuneRun } from './useTuneRun'

/** A noise cut in place: its amount, and the ReaFIR slot and state loaded into the session (null: no ReaFIR). */
export interface NoiseCutApplied {
  amount: NoiseCutAmount
  slot: number | null
  state: string | null
}

export interface NoiseCut {
  /** The amount picked (the applied one while a cut is in place). */
  amount: NoiseCutAmount
  applied: NoiseCutApplied | null
  /** A state load, the plan or the Noise Removal fit is under way. */
  busy: boolean
  /** The Noise Removal strength being rendered and measured now (null: none). */
  trying: number | null
  /** The last plan had nothing to cut (no usable ReaFIR or remover, no steady tone to cut). */
  empty: boolean
  /** What the last plan could not do. */
  notes: readonly Msg[]
  error: Msg | null
  /** Picks an amount; with a cut in place it cuts again with it. */
  setAmount(amount: NoiseCutAmount): void
  cut(amount?: NoiseCutAmount): Promise<void>
  undo(): Promise<void>
  /** Forgets the cut and takes its edits off (the session closed: its loaded state went with it). */
  reset(): void
}

interface State {
  take: Float32Array | null
  amount: NoiseCutAmount
  applied: NoiseCutApplied | null
  busy: boolean
  trying: number | null
  empty: boolean
  notes: readonly Msg[]
  error: Msg | null
}

const fresh = (take: Float32Array | null): State => ({ take, amount: 'normal', applied: null, busy: false, trying: null, empty: false, notes: [], error: null })

/**
 * "Cut the noise" on the result step (SPEC "Cut the noise"): the plan for the take (planNoiseCut, on the chain without
 * a previous cut). With a switched-on Elgato Noise Removal: the plan's edits rendered with its strength raised step by
 * step (fitRemover, through the session before any edit is handed over), then all of them as hand edits in one go,
 * rendered by the hand-edit queue; no re-tune. Without one: ReaFIR's state into the session first, the plan's edits,
 * then the same take tuned again. Undo puts ReaFIR's own state back (and tunes again then) and takes off the cut's
 * edits (values changed by hand since stay). A refused state load changes nothing. `entries` are the Wave Link
 * entries of the session's input (Save's); `onChange` runs when a cut goes on or off.
 */
export function useNoiseCut(take: Float32Array | null, run: TuneRun, manual: ManualEq, entries: readonly WlChainEntry[], onChange: () => void): NoiseCut {
  const [s, setS] = useState<State>(() => fresh(take))
  if (s.take !== take) setS(fresh(take))
  const working = useRef(false)

  /** Puts the session's ReaFIR back as `prev` had it, after a load toward `slot` failed (best effort). */
  const restore = async (prev: NoiseCutApplied | null, slot: number | null): Promise<void> => {
    const back = async (at: number, state: string | null): Promise<void> => run.setState(at, state).catch(() => undefined)
    if (slot !== null) await back(slot, prev?.slot === slot ? prev.state : null)
    if (prev && prev.slot !== null && prev.slot !== slot) await back(prev.slot, prev.state)
  }

  /** The plan's edits, with the Noise Removal strength the fit found, and the plan's notes with the fit's. */
  const fitted = async (t: Float32Array, plan: NoiseCutPlan, amount: NoiseCutAmount): Promise<{ values: CutValue[]; notes: Msg[] }> => {
    const result = run.state.step === 'done' ? run.state.result : null
    const edits = manual.withNoiseCut(plan.edits)
    if (!plan.remover || !result || !manual.tuned || !edits) return { values: plan.edits, notes: plan.notes }
    const onStep = (strength: number): void => setS((x) => ({ ...x, trying: strength }))
    const fit = await fitRemover({ take: t, result, tuned: manual.tuned, edits, render: run.render, remover: plan.remover, amount, onStep })
    return { values: fit.edit ? [...plan.edits, fit.edit] : plan.edits, notes: fit.note ? [...plan.notes, fit.note] : plan.notes }
  }

  const start = (): boolean => {
    if (working.current) return false
    working.current = true
    setS((x) => ({ ...x, busy: true, error: null }))
    return true
  }
  const failed = (e: unknown, amount: NoiseCutAmount): void => setS((x) => ({ ...x, busy: false, trying: null, amount, error: errorMsg(e) }))

  const cut = async (amount: NoiseCutAmount = s.amount): Promise<void> => {
    const chain = manual.withoutNoiseCut
    if (!take || !chain || !start()) return
    const prev = s.applied
    try {
      setS((x) => ({ ...x, amount }))
      const plan = planNoiseCut(take, chain, entries, amount)
      if (!prev && !plan.reafir && !plan.remover && plan.edits.length === 0) {
        setS((x) => ({ ...x, busy: false, empty: true, notes: plan.notes }))
        return
      }
      const slot = plan.reafir?.slot ?? null
      // ReaFIR first, then the fit's renders: when either fails, nothing else changes
      let done: { values: CutValue[]; notes: Msg[] }
      try {
        if (plan.reafir) await run.setState(plan.reafir.slot, plan.reafir.state)
        if (prev && prev.slot !== null && prev.slot !== slot) await run.setState(prev.slot, null)
        done = await fitted(take, plan, amount)
      } catch (e) {
        await restore(prev, slot)
        return failed(e, prev?.amount ?? amount)
      }
      if (!prev && !plan.reafir && done.values.length === 0) {
        setS((x) => ({ ...x, busy: false, trying: null, empty: true, notes: done.notes }))
        return
      }
      manual.setNoiseCut(done.values)
      setS((x) => ({ ...x, busy: false, trying: null, empty: false, applied: { amount, slot, state: plan.reafir?.state ?? null }, notes: done.notes }))
      onChange()
      // a plugin state loaded or put back: the voice is tuned again on it; else the edits render as hand edits
      if (slot !== null || (prev && prev.slot !== null)) await run.rerun()
    } catch (e) {
      failed(e, prev?.amount ?? amount)
    } finally {
      working.current = false
    }
  }

  const undo = async (): Promise<void> => {
    const prev = s.applied
    if (!prev || !start()) return
    try {
      if (prev.slot !== null) await run.setState(prev.slot, null)
    } catch (e) {
      await restore(prev, prev.slot)
      working.current = false
      return failed(e, prev.amount)
    }
    manual.setNoiseCut(null)
    setS((x) => ({ ...x, busy: false, applied: null, notes: [] }))
    working.current = false
    onChange()
    if (prev.slot !== null) await run.rerun()
  }

  return {
    amount: s.amount,
    applied: s.applied,
    busy: s.busy,
    trying: s.trying,
    empty: s.empty,
    notes: s.notes,
    error: s.error,
    setAmount: (amount) => {
      if (s.applied) void cut(amount)
      else setS((x) => ({ ...x, amount, empty: false }))
    },
    cut,
    undo,
    reset: () => {
      manual.setNoiseCut(null)
      setS((x) => fresh(x.take))
    },
  }
}
