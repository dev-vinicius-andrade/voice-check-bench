import { useEffect, useMemo, useState } from 'react'
import { eqKey, sameValue } from '../../../desktop/advice/chain'
import type { ChainSlot, EqField } from '../../../desktop/advice/types'
import { editManual, manualChain, tunedChain, type ManualEdit } from '../../../desktop/autotune/manualEq'
import type { NotchPlan, SpectrumTone } from '../../../desktop/spectrum'
import type { TuneResult } from '../../../desktop/tune'
import type { Msg } from '../../../plain/types'
import { sameTone } from '../tuning/spectrum/useToneCuts'
import { withCut, withoutCut, type CutValue, type NoiseCutEdits } from './noiseCutEdits'
import { useTakeRender } from './useTakeRender'
import type { TuneRun } from './useTuneRun'

/** A steady tone cut from the result step's tone list: the band used, the values it set and the ones it replaced. */
export interface TakeCut {
  tone: SpectrumTone
  slot: number
  n: number
  set: Readonly<Record<string, number>>
  before: Readonly<Record<string, number>>
}

interface EditState {
  take: Float32Array | null
  /** The tune result the edits were made on (a new one: the edits are applied again on top of it). */
  base: TuneResult | null
  edits: readonly ManualEdit[]
  cuts: readonly TakeCut[]
  /** The edits "Cut the noise" made (null: none). */
  noiseCut: NoiseCutEdits | null
}

export interface ManualEq {
  /** Values set by hand on the tuned chain. */
  edits: readonly ManualEdit[]
  /** The session's chain with the tuner's changes (null without a session or a result). */
  tuned: ChainSlot[] | null
  /** The tuned chain with the edits: what the plot's bands show. */
  chain: ChainSlot[] | null
  /** The result to show and play: the tuner's own, or measured again on the render with the edits. */
  result: TuneResult | null
  /** The shown chain without the noise cut's edits (what a new noise cut is planned on). */
  withoutNoiseCut: ChainSlot[] | null
  /** Cuts whose values are still on the chain. */
  cuts: readonly TakeCut[]
  busy: boolean
  error: Msg | null
  /** One value by hand (a band handle let go, a field, a wheel at rest). */
  set(slot: number, key: string, value: number): void
  /** notchPlan's values for a tone on `slot`, as hand edits in one go. */
  cut(slot: ChainSlot, plan: NotchPlan, tone: SpectrumTone): void
  /** Puts back the values a cut replaced. */
  undoCut(cut: TakeCut): void
  /** "Undo my changes": the tuner's own result again, without a render. */
  clear(): void
  /**
   * The noise cut's values as hand edits in one go, in place of the previous noise cut's; null takes them off. Off
   * means back to what they replaced, for the values still at what the cut set (one changed by hand since stays).
   */
  setNoiseCut(values: readonly CutValue[] | null): void
  /** The edits setNoiseCut(values) would give, without setting them (what a noise cut renders while it is fitted); null without a result. */
  withNoiseCut(values: readonly CutValue[]): readonly ManualEdit[] | null
}

const NONE: readonly ManualEdit[] = []
const fresh = (take: Float32Array | null): EditState => ({ take, base: null, edits: NONE, cuts: [], noiseCut: null })

/**
 * Hand changes to the ReaEQ on top of a tune result (SPEC "Tune from a recording — spectrum"): the edits, the chain
 * they make, and the take rendered with them through the session (useTakeRender). A new tune result (Adjust) keeps
 * the edits that still apply, on top of it; a new take (Record again) clears them.
 */
export function useManualEq(take: Float32Array | null, chain: ChainSlot[] | null, result: TuneResult | null, render: TuneRun['render']): ManualEq {
  const [state, setState] = useState<EditState>(() => fresh(take))
  const tuned = useMemo(() => (chain && result ? tunedChain(chain, result.changes) : null), [chain, result])

  // adjusted while rendering (no stale frame): a new take clears, a new result takes the edits over
  if (state.take !== take) setState(fresh(take))
  else if (result && tuned && state.base !== result) {
    const edits = state.edits.reduce((acc, e) => editManual(tuned, acc, e.slot, e.key, e.to), NONE)
    setState({ ...state, base: result, edits: edits.length ? edits : NONE })
  }

  const shownChain = useMemo(() => (tuned ? manualChain(tuned, state.edits) : null), [tuned, state.edits])
  const uncut = useMemo(() => (tuned ? manualChain(tuned, withoutCut(tuned, state.edits, state.noiseCut)) : null), [tuned, state.edits, state.noiseCut])
  const queue = useTakeRender(render)
  const { want } = queue
  const ready = state.take !== null && state.base !== null && state.base === result && state.edits.length > 0
  useEffect(() => {
    want(ready && state.take && state.base ? { take: state.take, base: state.base, edits: state.edits } : null)
  }, [want, ready, state.take, state.base, state.edits])

  const last = queue.last
  const shown = result && state.edits.length > 0 && last && last.job.base === result && last.job.take === take ? last.result : result

  const setAll = (slot: number, values: readonly (readonly [string, number])[], cuts: (c: readonly TakeCut[]) => readonly TakeCut[]): void => {
    if (!tuned) return
    setState((s) => ({ ...s, edits: values.reduce((acc, [key, to]) => editManual(tuned, acc, slot, key, to), s.edits), cuts: cuts(s.cuts) }))
  }
  const live = (c: TakeCut): boolean => {
    const values = shownChain?.find((s) => s.index === c.slot)?.values
    return !!values && Object.entries(c.set).every(([k, v]) => values[k] !== undefined && sameValue(values[k], v))
  }

  return {
    edits: state.edits,
    tuned,
    chain: shownChain,
    result: shown,
    cuts: state.cuts.filter(live),
    busy: queue.busy,
    error: queue.error,
    set: (slot, key, value) => setAll(slot, [[key, value]], (c) => c),
    cut: (slot, plan, tone) => {
      const steps: [EqField, number][] = [['freqHz', plan.freqHz], ['bwOct', plan.bwOct], ['gainDb', plan.gainDb]]
      if (plan.enable) steps.push(['on', 1])
      const keys = steps.map(([f, v]) => [eqKey(plan.n, f), v] as const).filter(([k]) => slot.values[k] !== undefined)
      const set = Object.fromEntries(keys)
      const before = Object.fromEntries(keys.map(([k]) => [k, slot.values[k]]))
      const made: TakeCut = { tone: { ...tone }, slot: slot.index, n: plan.n, set, before }
      setAll(slot.index, Object.entries(set), (cuts) => [...cuts.filter((c) => !sameTone(c.tone.freqHz, tone.freqHz) && c.n !== plan.n), made])
    },
    undoCut: (c) => setAll(c.slot, Object.entries(c.before), (cuts) => cuts.filter((x) => x !== c)),
    clear: () => setState((s) => ({ ...s, edits: NONE, cuts: [] })),
    withoutNoiseCut: uncut,
    withNoiseCut: (values) => (tuned ? withCut(tuned, withoutCut(tuned, state.edits, state.noiseCut), values).edits : null),
    setNoiseCut: (values) => {
      // while a run goes (no result): the last result's chain, so the cut can still come off
      const on = tuned ?? (chain && state.base ? tunedChain(chain, state.base.changes) : null)
      if (!on) return
      setState((s) => {
        const base = withoutCut(on, s.edits, s.noiseCut)
        const next = values ? withCut(on, base, values) : { edits: base, cut: null }
        return { ...s, edits: next.edits.length ? next.edits : NONE, noiseCut: next.cut }
      })
    },
  }
}
