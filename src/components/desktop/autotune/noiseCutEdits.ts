// The hand edits "Cut the noise" makes on the result step (SPEC "Cut the noise"): put on in one go, taken off again
// without touching what the person changed by hand since. No React.
import { sameValue, slotAt } from '../../../desktop/advice/chain'
import type { ChainSlot } from '../../../desktop/advice/types'
import { editManual, type ManualEdit } from '../../../desktop/autotune/manualEq'

/** One value the noise cut sets (NoiseCutPlan's edits). */
export interface CutValue {
  slot: number
  key: string
  to: number
}

/** The values a noise cut set and what each replaced: a hand value, or null for the tuned chain's own. */
export interface NoiseCutEdits {
  set: readonly CutValue[]
  before: readonly (number | null)[]
}

const handValue = (edits: readonly ManualEdit[], slot: number, key: string): number | undefined => edits.find((e) => e.slot === slot && e.key === key)?.to
const valueOf = (tuned: readonly ChainSlot[], edits: readonly ManualEdit[], slot: number, key: string): number | undefined =>
  handValue(edits, slot, key) ?? slotAt(tuned, slot)?.values[key]

/** `edits` without the cut: a value still at what the cut set goes back to what it replaced; one changed by hand since stays. */
export function withoutCut(tuned: readonly ChainSlot[], edits: readonly ManualEdit[], cut: NoiseCutEdits | null): readonly ManualEdit[] {
  if (!cut) return edits
  return cut.set.reduce((acc, v, i) => {
    const now = valueOf(tuned, acc, v.slot, v.key)
    if (now === undefined || !sameValue(now, v.to)) return acc
    const back = cut.before[i] ?? slotAt(tuned, v.slot)?.values[v.key]
    return back === undefined ? acc : editManual(tuned, acc, v.slot, v.key, back)
  }, edits)
}

/** `edits` with the cut's values on top, and the record that takes them off again. */
export function withCut(tuned: readonly ChainSlot[], edits: readonly ManualEdit[], values: readonly CutValue[]): { edits: readonly ManualEdit[]; cut: NoiseCutEdits } {
  const before = values.map((v) => handValue(edits, v.slot, v.key) ?? null)
  const next = values.reduce((acc, v) => editManual(tuned, acc, v.slot, v.key, v.to), edits)
  return { edits: next, cut: { set: values.map((v) => ({ ...v })), before } }
}
