// The "Save to Wave Link" confirmation lines: wavelink_preview's diff, worded per field where the plugin state can be
// decoded (ReaGate / ReaComp / ReaEQ, with the field labels the plugin windows show). Framework-free, returns Msgs.
import type { Msg } from '../plain/types'
import { stateChanges } from '../wavelink/changes'
import { b64decode, decodeState } from '../wavelink/fxp'
import { canonicalName, cockosKind } from '../wavelink/plugins'
import type { WlChange } from '../wavelink/types'
import type { WlChainChange, WlChainEntry, WlDiffLine } from './types'

const fieldMsg = (c: WlChange): Msg => ({ key: 'profiles.wl.preview.value', params: { plugin: c.plugin, field: c.field, from: c.from, to: c.to } })

function stateLines(line: WlDiffLine, plugin: string, changes: readonly WlChainChange[], entries: readonly WlChainEntry[]): Msg[] {
  const kind = cockosKind(line.plugin)
  const before = entries.find((e) => e.index === line.index)?.parameterState
  const after = changes.find((c) => c.index === line.index && c.inputKey === line.inputKey)?.parameterState
  if (kind && before && after) {
    try {
      const fields = stateChanges(plugin, decodeState(kind, b64decode(before)), decodeState(kind, b64decode(after)))
      if (fields.length) return fields.map(fieldMsg)
    } catch {
      // not decodable: worded as a whole-state change below
    }
  }
  return [{ key: 'desktop.save.state', params: { plugin } }]
}

/** One Msg per changed field, in diff order. */
export function describeDiff(lines: readonly WlDiffLine[], changes: readonly WlChainChange[], entries: readonly WlChainEntry[]): Msg[] {
  return lines.flatMap((line): Msg[] => {
    const plugin = canonicalName(line.plugin)
    if (line.field === 'bypass') return [{ key: line.to === 'off' ? 'profiles.wl.preview.turnOff' : 'profiles.wl.preview.turnOn', params: { plugin } }]
    if (line.field === 'chain') return [{ key: 'desktop.save.chain', params: { plugin: line.input } }]
    return stateLines(line, plugin, changes, entries)
  })
}
