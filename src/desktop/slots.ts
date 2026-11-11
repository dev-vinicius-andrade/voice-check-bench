// Adapter between the engine's chain slots (normalized VST parameters, src/desktop/types.ts AudioSlot) and the advice
// chain in real units (src/desktop/advice ChainSlot), both ways. Framework-free. Curves come from the ReaPlugs decoding
// in src/wavelink/fxp.ts: ReaGate/ReaComp floats are the bank values the engine reads with getParameter, ReaEQ values
// live in its chunk (re-encoded and loaded as a state), Elgato Noise Removal strength is its VAD Threshold × 100.
import { a2db, b64decode, b64encode, COMP_PARAMS, db2a, GATE_PARAMS, readEq, roundTrips, writeEq, type EqChunk } from '../wavelink/fxp'
import { matchesName } from '../wavelink/plugins'
import { eqKey } from './advice/chain'
import type { ChainSlot, Change, SlotKind } from './advice/types'
import type { AudioSlot, ParamInfo, SlotStatus, WlChainEntry } from './types'

/** dB values at or below this mean "off" (amplitude 0): ReaGate Wet −100 dB = gate off (advice/types.ts). */
export const DB_FLOOR = -100
/** Elgato Noise Removal's strength parameter. */
export const VAD_PARAM = 'VAD Threshold'

interface UnitMap {
  /** VST2 parameter index (= bank float index). */
  id: number
  toUnits: (normalized: number) => number
  fromUnits: (units: number) => number
}

function unitMap(params: typeof GATE_PARAMS, fxpKey: string, isDb: boolean): UnitMap {
  const p = params.find((m) => m.key === fxpKey)
  if (!p) throw new Error(`no ReaPlugs parameter ${fxpKey}`)
  const to = (v: number): number => Number(p.toValue(v))
  return isDb
    ? { id: p.index, toUnits: (v) => Math.max(DB_FLOOR, to(v)), fromUnits: (u) => (u <= DB_FLOOR ? 0 : p.fromValue(u)) }
    : { id: p.index, toUnits: to, fromUnits: (u) => p.fromValue(u) }
}

/** ChainSlot keys of ReaGate and ReaComp → their bank parameter and curve. */
export const PARAM_MAPS: Readonly<Partial<Record<SlotKind, Readonly<Record<string, UnitMap>>>>> = {
  reagate: {
    thresholdDb: unitMap(GATE_PARAMS, 'threshold', true),
    holdMs: unitMap(GATE_PARAMS, 'hold', false),
    releaseMs: unitMap(GATE_PARAMS, 'release', false),
    wetDb: unitMap(GATE_PARAMS, 'wet', true),
    dryDb: unitMap(GATE_PARAMS, 'dry', true),
  },
  reacomp: {
    thresholdDb: unitMap(COMP_PARAMS, 'threshold', true),
    ratio: unitMap(COMP_PARAMS, 'ratio', false),
    attackMs: unitMap(COMP_PARAMS, 'attack', false),
    releaseMs: unitMap(COMP_PARAMS, 'release', false),
    wetDb: unitMap(COMP_PARAMS, 'wet', true),
  },
}

/** What a slot is, from its Wave Link name and engine status. */
export function slotKind(name: string, status: SlotStatus['status']): SlotKind {
  if (status === 'builtIn') return 'builtin'
  const known: [string, SlotKind][] = [
    ['ReaGate', 'reagate'],
    ['ReaComp', 'reacomp'],
    ['ReaEQ', 'reaeq'],
    ['ReaFIR', 'reafir'],
    ['Elgato Noise Removal', 'noiseRemoval'],
    ['Noise Removal', 'noiseRemoval'],
    ['Elgato De-Esser', 'deesser'],
    ['Elgato EQ', 'elgatoEq'],
  ]
  return known.find(([n]) => matchesName(name, n))?.[1] ?? 'other'
}

/** The ReaEQ chunk of a ParameterState, or null when it is not one that re-encodes byte-identically. */
function eqChunk(parameterState: string): EqChunk | null {
  try {
    const blob = b64decode(parameterState)
    return roundTrips('reaeq', blob) ? readEq(blob) : null
  } catch {
    return null
  }
}

function eqValuesOf(chunk: EqChunk): Record<string, number> {
  const out: Record<string, number> = {}
  chunk.bands.forEach((b, k) => {
    out[eqKey(k + 1, 'type')] = b.type
    out[eqKey(k + 1, 'on')] = b.enabled !== 0 ? 1 : 0
    out[eqKey(k + 1, 'freqHz')] = b.freq
    out[eqKey(k + 1, 'gainDb')] = Math.max(DB_FLOOR, a2db(b.gain))
    out[eqKey(k + 1, 'bwOct')] = b.bw
  })
  return out
}

/** ReaEQ values (band<n>.*) of a stored ParameterState; {} when it cannot be read safely. */
export const eqStateValues = (parameterState: string): Record<string, number> => {
  const chunk = eqChunk(parameterState)
  return chunk ? eqValuesOf(chunk) : {}
}

/**
 * The ParameterState with ReaEQ values applied: only fields whose value differs from the stored one are rewritten,
 * every other byte stays as stored. Null when the stored state cannot be re-encoded safely.
 */
export function encodeEqState(parameterState: string, values: Readonly<Record<string, number>>): string | null {
  const chunk = eqChunk(parameterState)
  if (!chunk) return null
  const stored = eqValuesOf(chunk)
  const bands = chunk.bands.map((b, k) => {
    const pick = <T>(field: Parameters<typeof eqKey>[1], raw: T, toRaw: (v: number) => T): T => {
      const key = eqKey(k + 1, field)
      const v = values[key]
      return v === undefined || v === stored[key] ? raw : toRaw(v)
    }
    return {
      ...b,
      type: pick('type', b.type, (v) => v),
      enabled: pick('on', b.enabled, (v) => (v ? 1 : 0)),
      freq: pick('freqHz', b.freq, (v) => v),
      gain: pick('gainDb', b.gain, (v) => (v <= DB_FLOOR ? 0 : db2a(v))),
      bw: pick('bwOct', b.bw, (v) => v),
    }
  })
  return b64encode(writeEq({ ...chunk, bands }))
}

const vadParam = (params: readonly ParamInfo[]): ParamInfo | undefined => params.find((p) => p.name === VAD_PARAM)

/** Values in real units of one engine slot (ReaEQ from its stored state, which the engine started from). */
export function slotValues(kind: SlotKind, slot: AudioSlot, entry: WlChainEntry | null): Record<string, number> {
  const maps = PARAM_MAPS[kind]
  if (maps) {
    const out: Record<string, number> = {}
    for (const [key, m] of Object.entries(maps)) {
      const p = slot.params.find((x) => x.id === m.id)
      if (p) out[key] = m.toUnits(p.normalized)
    }
    return out
  }
  if (kind === 'reaeq') return entry ? eqStateValues(entry.parameterState) : {}
  if (kind === 'noiseRemoval') {
    const p = vadParam(slot.params)
    return p ? { strength: p.normalized * 100 } : {}
  }
  return {}
}

/** The advice chain of the engine's slots; `entries` are the same input's Wave Link entries (by index), if read. */
export function chainOf(slots: readonly AudioSlot[], entries: readonly WlChainEntry[] | null): ChainSlot[] {
  return slots.map((s) => {
    const kind = slotKind(s.name, s.status.status)
    const entry = entries?.find((e) => e.index === s.index) ?? null
    return { index: s.index, kind, name: s.name, on: !s.bypassed, values: slotValues(kind, s, entry) }
  })
}

/** One engine command. */
export type EngineOp =
  | { op: 'param'; slot: number; id: number; value: number }
  | { op: 'state'; slot: number; parameterState: string }
  | { op: 'bypass'; slot: number; bypassed: boolean }

/**
 * The engine command that puts a change into effect. `chain` is the chain with the change already applied (ReaEQ sends
 * its whole state). Null when the slot has no such value.
 */
export function engineOp(c: Change, chain: readonly ChainSlot[], slots: readonly AudioSlot[], entries: readonly WlChainEntry[] | null): EngineOp | null {
  const target = chain.find((s) => s.index === c.slot)
  const slot = slots.find((s) => s.index === c.slot)
  if (!target || !slot) return null
  if (c.kind === 'switch') return { op: 'bypass', slot: c.slot, bypassed: !c.on }
  const map = PARAM_MAPS[target.kind]?.[c.key]
  if (map) return { op: 'param', slot: c.slot, id: map.id, value: map.fromUnits(c.to) }
  if (target.kind === 'noiseRemoval' && c.key === 'strength') {
    const p = vadParam(slot.params)
    return p ? { op: 'param', slot: c.slot, id: p.id, value: Math.min(1, Math.max(0, c.to / 100)) } : null
  }
  if (target.kind === 'reaeq') {
    const entry = entries?.find((e) => e.index === c.slot)
    const state = entry ? encodeEqState(entry.parameterState, target.values) : null
    return state ? { op: 'state', slot: c.slot, parameterState: state } : null
  }
  return null
}
