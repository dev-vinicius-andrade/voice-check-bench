// Plugin naming and matching for Wave Link inputs, and the suggestion check of the Python tool. Framework-free.
import type { SuggestionJson } from '../settings/suggest'
import type { CockosKind } from './fxp'

/** Canonical ReaPlugs names (as in suggestion chains and profile states) and their decoded kind. */
export const REAPLUGS: readonly { name: string; kind: CockosKind | null }[] = [
  { name: 'ReaGate', kind: 'reagate' },
  { name: 'ReaComp', kind: 'recomp' },
  { name: 'ReaEQ', kind: 'reaeq' },
  { name: 'ReaFIR', kind: null },
]
export const REAPLUG_NAMES: readonly string[] = REAPLUGS.map((p) => p.name)
export const DEESSER = 'Elgato De-Esser'

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * True when a plugin named `pluginName` in Wave Link is the effect `wanted`: case, spaces and punctuation are
 * ignored and the plugin name may continue ("ReaFir (ReaPlugs Edition)" is ReaFIR, "VoiceFocus" is Voice Focus).
 */
export const matchesName = (pluginName: string, wanted: string): boolean => {
  const w = norm(wanted)
  return w.length > 0 && norm(pluginName).startsWith(w)
}

/** "ReaEQ (ReaPlugs Edition)" → "ReaEQ"; any other plugin keeps its own name. */
export const canonicalName = (pluginName: string): string => REAPLUGS.find((p) => matchesName(pluginName, p.name))?.name ?? pluginName

/** Decoded kind of a plugin name (ReaGate / ReaComp / ReaEQ), null for everything else. */
export const cockosKind = (pluginName: string): CockosKind | null => REAPLUGS.find((p) => matchesName(pluginName, p.name))?.kind ?? null

// ---------------------------------------------------------------- suggestion check (validate() in the Python tool)

const EQ_TYPE_NAMES = ['Low Shelf', 'Band', 'High Shelf']
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Problems with a suggestion before it is written (empty when fine). Same ranges as tools/apply-reaplugs.py. */
export function validateSuggestion(s: SuggestionJson | unknown): string[] {
  const errs: string[] = []
  if (!isObj(s)) return ['the suggestion must be an object']
  const num = (where: string, v: unknown, lo: number, hi: number) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) errs.push(`${where} must be a number`)
    else if (v < lo || v > hi) errs.push(`${where} = ${v} is outside ${lo}..${hi}`)
  }
  const section = (name: string, spec: readonly (readonly [string, number, number] | readonly [string])[]) => {
    const sec = s[name]
    if (!isObj(sec)) return void errs.push(`'${name}' must be an object`)
    for (const [key, lo, hi] of spec) {
      if (!(key in sec)) errs.push(`'${name}.${key}' is missing`)
      else if (lo === undefined || hi === undefined) {
        if (typeof sec[key] !== 'boolean') errs.push(`'${name}.${key}' must be true or false`)
      } else num(`'${name}.${key}'`, sec[key], lo, hi)
    }
  }
  if (!['gate', 'eq', 'comp', 'deess'].some((k) => k in s)) errs.push("none of 'gate', 'eq', 'comp', 'deess' is present")
  if ('gate' in s)
    section('gate', [['threshold', -100, 0], ['attack', 0, 500], ['release', 0, 5000], ['hold', 0, 1000], ['hysteresis', -100, 0], ['wet', -100, 24], ['dry', -100, 24]])
  if ('comp' in s) section('comp', [['threshold', -100, 0], ['ratio', 1, 100], ['attack', 0, 500], ['release', 0, 5000], ['wet', -100, 24], ['limit']])
  if ('eq' in s) {
    if (!Array.isArray(s.eq)) errs.push("'eq' must be a list of bands")
    else
      s.eq.forEach((e: unknown, k: number) => {
        const i = k + 1
        if (!isObj(e)) return void errs.push(`'eq' band ${i} must be an object`)
        for (const key of ['type', 'freq', 'gain', 'bw']) if (!(key in e)) errs.push(`'eq' band ${i}: '${key}' is missing`)
        if ('type' in e && !EQ_TYPE_NAMES.includes(e.type as string)) errs.push(`'eq' band ${i}: bad type`)
        if ('freq' in e) num(`'eq' band ${i} freq`, e.freq, 20, 20000)
        if ('gain' in e) num(`'eq' band ${i} gain`, e.gain, -40, 40)
        if ('bw' in e) num(`'eq' band ${i} bw`, e.bw, 0.05, 8)
      })
  }
  if ('deess' in s && typeof s.deess !== 'boolean') errs.push("'deess' must be true or false")
  if (s.lowcut !== undefined && s.lowcut !== null) num("'lowcut'", s.lowcut, 0, 1000)
  return errs
}
