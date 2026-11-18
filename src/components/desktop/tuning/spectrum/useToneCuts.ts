import { useState } from 'react'
import { eqKey, withChange } from '../../../../desktop/advice/chain'
import type { Advice, ChainSlot, EqField } from '../../../../desktop/advice/types'
import { changeLineMsg } from '../../../../desktop/changeMsg'
import { notchPlan, type EqPoint, type NotchPlan, type SpectrumTone } from '../../../../desktop/spectrum'
import type { BatchOp, ChainState } from '../useChainState'

/** A cut made from the tone list: the tone as it was, the band used and the chain entries that undo it. */
export interface ToneCut {
  tone: SpectrumTone
  n: number
  ids: readonly string[]
}

/** One row of the tone list: a tone heard now and/or the cut made for it. */
export interface ToneRow {
  tone: SpectrumTone
  cut: ToneCut | null
  /** What Cut would do; null when no band is free (or no ReaEQ is on). */
  plan: NotchPlan | null
}

/** The same tone when within this many octaves (its frequency wanders a little). */
const SAME_TONE_OCT = 1 / 12
const near = (a: number, b: number): boolean => Math.abs(Math.log2(a / b)) < SAME_TONE_OCT

/** The changes of a cut, in order, each with its exact change line on the chain as it is by then. */
function cutAdvice(slot: ChainSlot, plan: NotchPlan, tone: SpectrumTone): Advice[] {
  const title = { key: 'desktop.tune.spectrum.tones.cutTitle', params: { hz: Math.round(tone.freqHz) } }
  const steps: [EqField, number][] = [['freqHz', plan.freqHz], ['bwOct', plan.bwOct], ['gainDb', plan.gainDb]]
  if (plan.enable) steps.push(['on', 1])
  const out: Advice[] = []
  let chain: ChainSlot[] = [slot]
  for (const [field, to] of steps) {
    const key = eqKey(plan.n, field)
    const now = chain[0]
    const change = { id: `tone:${slot.index}:${key}`, reason: 'tone' as const, kind: 'value' as const, slot: slot.index, key, from: now.values[key] ?? 0, to, titleMsg: title }
    out.push({ ...change, changeMsg: changeLineMsg(now, change) })
    chain = withChange(chain, change)
  }
  return out
}

/**
 * "Cut" on a steady tone: notchPlan's band values as one batch on the live chain (entries with their own Undo, so
 * markers and Save see them), the band selected; "Undo" puts the band back. A tone that goes away leaves the list
 * unless it was cut here (its row keeps the Undo).
 */
export function useToneCuts(chain: Pick<ChainState, 'applied' | 'applyBatch'>, slot: ChainSlot | null, points: readonly EqPoint[], tones: readonly SpectrumTone[], onSelect: (n: number) => void) {
  const [made, setMade] = useState<readonly ToneCut[]>([])
  // entries undone elsewhere (Try this, a new Start) are no longer this cut's
  const live = new Set(chain.applied.map((a) => a.appliedId))
  const cuts = made.map((c) => ({ ...c, ids: c.ids.filter((id) => live.has(id)) })).filter((c) => c.ids.length > 0)

  const rows: ToneRow[] = tones.map((tone) => ({ tone, cut: cuts.find((c) => near(c.tone.freqHz, tone.freqHz)) ?? null, plan: slot ? notchPlan(points, tone) : null }))
  for (const c of cuts) if (!rows.some((r) => r.cut === c)) rows.push({ tone: c.tone, cut: c, plan: null })

  const cut = (tone: SpectrumTone): void => {
    const plan = slot && notchPlan(points, tone)
    if (!slot || !plan) return
    const batch: BatchOp[] = cutAdvice(slot, plan, tone).map((advice) => ({ op: 'apply', advice }))
    const ids = chain.applyBatch(batch).filter((id): id is string => id !== null)
    if (ids.length) setMade((list) => [...list.filter((c) => !near(c.tone.freqHz, tone.freqHz)), { tone: { ...tone }, n: plan.n, ids }])
    onSelect(plan.n)
  }

  const undo = (c: ToneCut): void => {
    const done = chain.applyBatch([...c.ids].reverse().map((appliedId) => ({ op: 'undo', appliedId })))
    const undone = new Set(done.filter((id): id is string => id !== null))
    setMade((list) => list.map((m) => (m.tone === c.tone ? { ...m, ids: m.ids.filter((id) => !undone.has(id)) } : m)).filter((m) => m.ids.length > 0))
  }

  return { rows, cut, undo }
}
