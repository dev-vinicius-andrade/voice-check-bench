// Reading and changing ChainSlot values (./types.ts). Pure, framework-free.
import { EQ_TYPES, eqTypeName, type EqTypeName } from '../../wavelink/fxp'
import type { Change, ChainSlot, EqField, EqKey, SlotKind } from './types'

/** Two values count as equal within this much (engine values come back through float32 parameters). */
export const VALUE_EPS = 1e-3

export const sameValue = (a: number, b: number): boolean => a === b || Math.abs(a - b) <= VALUE_EPS

/** `band<n>.<field>` of a ReaEQ slot, n 1-based. */
export const eqKey = (n: number, field: EqField): EqKey => `band${n}.${field}`

/** A ReaEQ band read from a slot's values. */
export interface EqBandView {
  /** 1-based band number. */
  n: number
  type: EqTypeName | 'Other'
  on: boolean
  freqHz: number
  gainDb: number
  bwOct: number
}

/** The ReaEQ bands of a slot, in band order, while band<n>.freqHz exists from n = 1 (a band without type/gain is skipped). */
export function eqBands(slot: Pick<ChainSlot, 'values'>): EqBandView[] {
  const out: EqBandView[] = []
  const v = slot.values
  for (let n = 1; eqKey(n, 'freqHz') in v; n++) {
    const type = v[eqKey(n, 'type')]
    const gainDb = v[eqKey(n, 'gainDb')]
    if (type === undefined || gainDb === undefined) continue
    out.push({ n, type: eqTypeName(type), on: (v[eqKey(n, 'on')] ?? 1) !== 0, freqHz: v[eqKey(n, 'freqHz')], gainDb, bwOct: v[eqKey(n, 'bwOct')] ?? NaN })
  }
  return out
}

/** Values of ReaEQ bands (inverse of eqBands; n from 1 in list order). */
export function eqValues(bands: readonly Omit<EqBandView, 'n'>[]): Record<string, number> {
  const out: Record<string, number> = {}
  bands.forEach((b, i) => {
    const n = i + 1
    out[eqKey(n, 'type')] = b.type === 'Other' ? -1 : EQ_TYPES[b.type]
    out[eqKey(n, 'on')] = b.on ? 1 : 0
    out[eqKey(n, 'freqHz')] = b.freqHz
    out[eqKey(n, 'gainDb')] = b.gainDb
    out[eqKey(n, 'bwOct')] = b.bwOct
  })
  return out
}

/** Slot by its chain index. */
export const slotAt = (chain: readonly ChainSlot[], index: number): ChainSlot | undefined => chain.find((s) => s.index === index)

/** Switched-on slots of a kind that have every key, in chain order. */
export const slotsWith = (chain: readonly ChainSlot[], kind: SlotKind, ...keys: string[]): ChainSlot[] =>
  chain.filter((s) => s.kind === kind && s.on && keys.every((k) => Number.isFinite(s.values[k])))

/** Current value a change addresses: the number for a value change, on/off for a switch; undefined when the slot or key is missing. */
export function currentOf(chain: readonly ChainSlot[], c: Change): number | boolean | undefined {
  const s = slotAt(chain, c.slot)
  if (!s) return undefined
  if (c.kind === 'switch') return s.on
  return Object.hasOwn(s.values, c.key) ? s.values[c.key] : undefined
}

/** The chain with a change applied (a new array; untouched slots are shared). Unchanged when the slot is missing. */
export function withChange(chain: readonly ChainSlot[], c: Change): ChainSlot[] {
  return chain.map((s) => {
    if (s.index !== c.slot) return s
    return c.kind === 'switch' ? { ...s, on: c.on } : { ...s, values: { ...s.values, [c.key]: c.to } }
  })
}
