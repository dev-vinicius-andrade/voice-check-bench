// What "Save to Wave Link" writes: the live chain compared with the Wave Link entries it started from → ChainChanges
// for wavelink_preview / wavelink_export. Framework-free. ReaGate/ReaComp: the stored bank with only the changed
// floats re-packed (taken from the engine's parameters); ReaEQ: the stored chunk with only the changed band fields;
// VST2 on/off: BypassState. Elgato (VST3): the engine's own state export (audio_export_states), whose ParameterState
// carries the plugin's values and its own bypass, written together with the matching BypassState.
import { b64decode, b64encode, readBank, writeBank } from '../wavelink/fxp'
import { sameValue } from './advice/chain'
import type { ChainSlot } from './advice/types'
import { encodeEqState, PARAM_MAPS } from './slots'
import type { AudioExportedState, AudioSlot, WlChainChange, WlChainEntry } from './types'

export interface ExportPlan {
  changes: WlChainChange[]
  /** Slot indices changed live whose change cannot be written (kept as they are in Wave Link): an Elgato effect
   * when the engine's states could not be read (engine stopped). */
  unsaved: number[]
}

const valuesDiffer = (a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>): boolean =>
  Object.keys({ ...a, ...b }).some((k) => a[k] === undefined || b[k] === undefined || !sameValue(a[k], b[k]))

/** The stored ReaGate/ReaComp bank with the engine's floats where they differ; null when nothing differs. */
function bankState(entry: WlChainEntry, slot: AudioSlot, kind: ChainSlot['kind']): string | null {
  const maps = PARAM_MAPS[kind]
  if (!maps) return null
  const blob = b64decode(entry.parameterState)
  const bank = readBank(blob)
  const changed = new Set<number>()
  for (const m of Object.values(maps)) {
    const p = slot.params.find((x) => x.id === m.id)
    if (!p || m.id >= bank.vals.length) continue
    const f = Math.fround(p.normalized)
    if (Object.is(f, bank.vals[m.id])) continue
    bank.vals[m.id] = f
    changed.add(m.id)
  }
  return changed.size ? b64encode(writeBank(bank, blob, changed)) : null
}

/** An Elgato slot changed live → its exported state and bypass, where they differ from the stored ones. */
function vst3Change(inputKey: string, entry: WlChainEntry, ex: AudioExportedState): WlChainChange | null {
  const state = ex.parameterState && ex.parameterState !== entry.parameterState ? ex.parameterState : null
  const bypass = ex.bypassed !== entry.bypassed
  if (state === null && !bypass) return null
  return { inputKey, index: entry.index, ...(state !== null ? { parameterState: state } : {}), ...(bypass ? { bypassed: ex.bypassed } : {}) }
}

/**
 * Changes for input `inputKey`. `start` is the chain as it was read from Wave Link (to tell what changed live),
 * `chain` the live one, `slots` the engine's (current parameters), `entries` the stored Wave Link entries,
 * `exported` the engine's audio_export_states (null when it could not be read).
 */
export function exportPlan(
  inputKey: string,
  start: readonly ChainSlot[],
  chain: readonly ChainSlot[],
  slots: readonly AudioSlot[],
  entries: readonly WlChainEntry[],
  exported: readonly AudioExportedState[] | null = null,
): ExportPlan {
  const changes: WlChainChange[] = []
  const unsaved: number[] = []
  for (const c of chain) {
    const entry = entries.find((e) => e.index === c.index)
    const slot = slots.find((s) => s.index === c.index)
    const before = start.find((s) => s.index === c.index)
    if (!entry || !slot || !before || slot.status.status !== 'hosted') continue
    const switched = c.on !== !entry.bypassed
    if (slot.status.kind === 'vst3') {
      if (!switched && c.on === before.on && !valuesDiffer(c.values, before.values)) continue
      const ex = exported?.find((e) => e.index === c.index)
      const change = ex ? vst3Change(inputKey, entry, ex) : null
      if (change) changes.push(change)
      else if (!ex) unsaved.push(c.index)
      continue
    }
    let parameterState: string | null = null
    try {
      if (c.kind === 'reaeq') {
        const s = encodeEqState(entry.parameterState, c.values)
        parameterState = s !== null && s !== entry.parameterState ? s : null
      } else parameterState = bankState(entry, slot, c.kind)
    } catch {
      if (valuesDiffer(c.values, before.values)) unsaved.push(c.index)
    }
    if (parameterState === null && !switched) continue
    changes.push({
      inputKey,
      index: c.index,
      ...(parameterState !== null ? { parameterState } : {}),
      ...(switched ? { bypassed: !c.on } : {}),
    })
  }
  return { changes, unsaved }
}
