// Wave Link Settings.json codec (SPEC "Profiles revision — Wave Link file round trip"): TypeScript port of
// tools/apply-reaplugs.py. parseSettings decodes every plugin of every input; applyPlan writes a suggestion and/or
// exact profile states into the existing plugins and returns the new text with the original formatting.
// Framework-free; browser and Node (no Node-only APIs).
import type { SuggestionJson } from '../settings/suggest'
import { describeChanges } from './changes'
import { COMP_PARAMS, EQ_TYPES, GATE_PARAMS, b64decode, b64encode, db2a, decodeState, readBank, readEq, roundTrips, writeBank, writeEq, type EqRawBand } from './fxp'
import { type JNode, detectFormat, dumpTree, parseTree, prop, setProp } from './json'
import { DEESSER, canonicalName, cockosKind, matchesName, validateSuggestion } from './plugins'
import type { WlApplyPlan, WlApplyResult, WlFile, WlInput, WlPlugin, WlPluginState } from './types'

export type WlParseErrorCode = 'notJson' | 'notWaveLink'

/** Thrown by parseSettings: the text is not JSON, or not a Wave Link settings file. */
export class WlParseError extends Error {
  readonly code: WlParseErrorCode
  constructor(code: WlParseErrorCode, message: string) {
    super(message)
    this.name = 'WlParseError'
    this.code = code
  }
}

const strOf = (n: JNode | undefined): string | null => (n?.t === 'str' ? n.v : null)

/** [key, input node, plugin nodes] of every input that has an AudioPluginConfigurations list. */
function inputNodes(tree: JNode): [string, JNode, JNode[]][] {
  const settings = prop(prop(tree, 'MixerConfiguration'), 'InputSettings')
  if (settings?.t !== 'obj') return []
  return settings.entries.flatMap(([key, node]): [string, JNode, JNode[]][] => {
    const list = prop(node, 'AudioPluginConfigurations')
    return list?.t === 'arr' ? [[key, node, list.items]] : []
  })
}

/** A plugin as decoded from its node. ReaGate/ReaComp/ReaEQ blobs that do not round-trip byte-identically stay opaque. */
function decodePlugin(node: JNode, index: number): WlPlugin {
  const name = strOf(prop(node, 'Name')) ?? ''
  const parameterState = strOf(prop(node, 'ParameterState')) ?? ''
  const bypass = prop(node, 'BypassState')
  const kind = cockosKind(name)
  let state: WlPluginState = { kind: 'opaque' }
  if (kind && parameterState) {
    try {
      const blob = b64decode(parameterState)
      if (roundTrips(kind, blob)) state = decodeState(kind, blob)
    } catch {
      // malformed base64 or blob: kept opaque, never re-encoded
    }
  }
  return { index, name, vendor: strOf(prop(node, 'Vendor')) ?? '', on: !(bypass?.t === 'bool' && bypass.v), state, parameterState }
}

const hasReaPlugs = (inp: WlInput): boolean => inp.plugins.some((p) => cockosKind(p.name) !== null)
const isMicKey = (key: string): boolean => key.includes('PCM_IN')

/**
 * Parses Settings.json. Inputs: every input with at least one effect, plus empty PCM_IN (mic) inputs; the likely mic
 * comes first (PCM_IN with ReaPlugs, then any input with ReaPlugs, then PCM_IN, then the rest, each in file order).
 * Throws WlParseError when the text is not JSON or has no MixerConfiguration.InputSettings input with effects list.
 */
export function parseSettings(text: string): WlFile {
  let tree: JNode
  try {
    tree = parseTree(text)
  } catch (e) {
    throw new WlParseError('notJson', e instanceof Error ? e.message : 'invalid JSON')
  }
  const nodes = inputNodes(tree)
  if (!nodes.length) throw new WlParseError('notWaveLink', 'no MixerConfiguration.InputSettings input with AudioPluginConfigurations')
  const inputs = nodes
    .filter(([key, , items]) => items.length > 0 || isMicKey(key))
    .map(([key, node, items]): WlInput => ({ key, label: strOf(prop(node, 'InputName')) || key, plugins: items.map(decodePlugin) }))
  const rank = (inp: WlInput): number => (hasReaPlugs(inp) ? 0 : 2) + (isMicKey(inp.key) ? 0 : 1)
  return { text, inputs: inputs.map((inp, k) => ({ inp, k })).sort((a, b) => rank(a.inp) - rank(b.inp) || a.k - b.k).map((x) => x.inp) }
}

/** Key of the likely mic input (the first input of parseSettings), or null when there is none. */
export const micInputKey = (file: WlFile): string | null => file.inputs[0]?.key ?? null

/** Text of a (modified) tree in the format of the file's original text: CRLF, indent, .NET escaping, BOM, final newline. */
export const serialize = (file: WlFile, tree: JNode): string => dumpTree(tree, detectFormat(file.text))

/** Index of the plugin matching `name` (the last one, like the Python tool), or -1. */
const findPlugin = (plugins: readonly WlPlugin[], name: string): number => plugins.findLastIndex((p) => matchesName(p.name, name))

/** Blob of a decodable plugin, or an error when its state could not be read safely (never written blindly). */
function blobOf(p: WlPlugin): Uint8Array {
  if (p.state.kind === 'opaque') throw new Error(`${canonicalName(p.name)}: its stored state could not be read safely; not changed`)
  return b64decode(p.parameterState)
}

function encodeBank(p: WlPlugin, params: typeof GATE_PARAMS, values: Record<string, number | boolean>): string {
  const blob = blobOf(p)
  const bank = readBank(blob)
  const changed = new Set<number>()
  for (const m of params) {
    if (m.index >= bank.vals.length) throw new Error(`${canonicalName(p.name)}: parameter ${m.index} is missing`)
    bank.vals[m.index] = m.fromValue(values[m.key])
    changed.add(m.index)
  }
  return b64encode(writeBank(bank, blob, changed))
}

function encodeEq(p: WlPlugin, eq: SuggestionJson['eq']): string {
  const chunk = readEq(blobOf(p))
  const flag = chunk.bands[0]?.flag ?? 1
  let bands: EqRawBand[] = eq.map((e) => ({ type: EQ_TYPES[e.type], enabled: 1, freq: e.freq, gain: db2a(e.gain), bw: e.bw, flag }))
  if (!bands.length) bands = [{ type: 8, enabled: 1, freq: 1000, gain: 1, bw: 1, flag }] // one flat band keeps the plugin valid
  return b64encode(writeEq({ ...chunk, bands }))
}

/**
 * Applies a plan to the input `plan.inputKey`: suggestion values (gate/comp floats, EQ bands, De-Esser on/off),
 * then exact restored states, then switchOff/switchOn. Only ParameterState/BypassState of touched plugins change.
 * Plugins the plan needs that are not on the input are listed in `missing`. Throws when the input does not exist,
 * the suggestion is invalid, or a plugin to change has a state that cannot be re-encoded safely.
 */
export function applyPlan(file: WlFile, plan: WlApplyPlan): WlApplyResult {
  const tree = parseTree(file.text)
  const entry = inputNodes(tree).find(([key]) => key === plan.inputKey)
  if (!entry) throw new Error(`input ${plan.inputKey} not found`)
  const nodes = entry[2]
  const plugins = nodes.map(decodePlugin)
  const missing: string[] = []
  const need = (name: string): number => {
    const k = findPlugin(plugins, name)
    if (k < 0 && !missing.includes(name)) missing.push(name)
    return k
  }
  const states = new Map<number, string>()
  const bypass = new Map<number, boolean>()
  const restored = new Set<number>()

  const s = plan.suggestion
  if (s) {
    const errs = validateSuggestion(s)
    if (errs.length) throw new Error(`invalid suggestion: ${errs.join('; ')}`)
    const sections = [s.gate && 'ReaGate', s.eq && 'ReaEQ', s.comp && 'ReaComp'].filter((n): n is string => !!n)
    for (const name of [...(s.chain ?? []), ...sections]) need(name)
    const gate = findPlugin(plugins, 'ReaGate')
    if (gate >= 0 && s.gate) states.set(gate, encodeBank(plugins[gate], GATE_PARAMS, s.gate))
    const eq = findPlugin(plugins, 'ReaEQ')
    if (eq >= 0 && s.eq) states.set(eq, encodeEq(plugins[eq], s.eq))
    const comp = findPlugin(plugins, 'ReaComp')
    if (comp >= 0 && s.comp) states.set(comp, encodeBank(plugins[comp], COMP_PARAMS, s.comp))
    if (typeof s.deess === 'boolean') {
      const de = s.deess ? need(DEESSER) : findPlugin(plugins, DEESSER)
      if (de >= 0) bypass.set(de, !s.deess)
    }
  }
  for (const [name, state] of Object.entries(plan.restoreStates ?? {})) {
    const k = need(name)
    if (k >= 0) {
      states.set(k, state)
      restored.add(k)
    }
  }
  for (const name of plan.switchOff ?? []) {
    const k = findPlugin(plugins, name)
    if (k >= 0) bypass.set(k, true)
  }
  for (const name of plan.switchOn ?? []) {
    const k = need(name)
    if (k >= 0) bypass.set(k, false)
  }

  let touched = false
  for (const [k, v] of states) {
    if (v === plugins[k].parameterState) continue
    setProp(nodes[k], 'ParameterState', { t: 'str', v })
    touched = true
  }
  for (const [k, v] of bypass) {
    const old = prop(nodes[k], 'BypassState')
    if (old?.t === 'bool' && old.v === v) continue
    setProp(nodes[k], 'BypassState', { t: 'bool', v })
    touched = true
  }
  const after = nodes.map(decodePlugin)
  return {
    text: touched ? serialize(file, tree) : file.text,
    changes: describeChanges(plugins, after, restored, missing),
    missing,
  }
}
