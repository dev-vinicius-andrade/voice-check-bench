// The exact change line of any live change (slider, switch, undo), for history markers and segment labels:
// "ReaGate Dry 0 → −20 dB". Framework-free; plugin names and plugin field labels stay English (params).
import type { Msg } from '../plain/types'
import { eqTypeName } from '../wavelink/fxp'
import { canonicalName } from '../wavelink/plugins'
import { dbChangeMsg, eqChangeMsg, strengthChangeMsg } from './advice/msgs'
import type { ChainSlot, Change } from './advice/types'

/** Plugin window labels of the slider keys. */
export const FIELD_LABELS: Readonly<Record<string, string>> = {
  thresholdDb: 'Threshold',
  holdMs: 'Hold',
  releaseMs: 'Release',
  attackMs: 'Attack',
  wetDb: 'Wet',
  dryDb: 'Dry',
  ratio: 'Ratio',
}

const msg = (key: string, params: Msg['params']): Msg => ({ key: `desktop.advice.change.${key}`, params })

export function changeLineMsg(slot: ChainSlot, c: Change): Msg {
  const plugin = canonicalName(slot.name)
  if (c.kind === 'switch') return msg(c.on ? 'on' : 'off', { plugin })
  const { key, from, to } = c
  const band = /^band(\d+)\.(\w+)$/.exec(key)
  if (band) {
    const n = Number(band[1])
    const type = eqTypeName(slot.values[`band${n}.type`] ?? -1)
    if (band[2] === 'gainDb') return eqChangeMsg(slot, type === 'Other' ? `Band ${n}` : type, Math.round(slot.values[`band${n}.freqHz`] ?? 0), from, to)
    return msg('hz', { plugin, n, from: Math.round(from), to: Math.round(to) })
  }
  if (key === 'strength') return strengthChangeMsg(slot, from, to)
  if (key === 'ratio') return msg('ratio', { plugin, from, to })
  if (key.endsWith('Ms')) return msg('ms', { plugin, field: FIELD_LABELS[key] ?? key, from, to })
  return dbChangeMsg(slot, FIELD_LABELS[key] ?? key, from, to)
}
