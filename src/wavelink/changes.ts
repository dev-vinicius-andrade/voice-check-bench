// Human list of what applyPlan changed, with the field labels the plugin windows show. Framework-free.
// Values are plain numbers as text ("-34", "2.5", "-inf"); on/off as 'on' / 'off'; '—' for a band that does not exist.
import { COMP_PARAMS, GATE_PARAMS } from './fxp'
import { canonicalName } from './plugins'
import type { WlChange, WlPlugin, WlPluginState } from './types'

const NONE = '—'

/** Number as short text: rounded to `digits`, no trailing zeros, ±inf for silence. */
export const fmtValue = (v: number, digits = 1): string =>
  Number.isFinite(v) ? String(+v.toFixed(digits)) : Number.isNaN(v) ? 'NaN' : v < 0 ? '-inf' : 'inf'

const DIGITS: Record<string, number> = { freq: 0, bw: 2 }
const show = (v: number | boolean | string | undefined, key = ''): string =>
  v === undefined ? NONE : typeof v === 'boolean' ? (v ? 'on' : 'off') : typeof v === 'string' ? v : fmtValue(v, DIGITS[key] ?? 1)

type Bands = Extract<WlPluginState, { kind: 'reaeq' }>['bands']
const BAND_FIELDS: readonly [keyof Bands[number], string][] = [
  ['type', 'Type'],
  ['enabled', 'Enabled'],
  ['freq', 'Frequency (Hz)'],
  ['gain', 'Gain (dB)'],
  ['bw', 'Bandwidth (oct)'],
]

/** "Band 1000 Hz 3 dB bw 1.5" (+ " off" when disabled). */
const bandText = (x: Bands[number]): string =>
  `${x.type} ${show(x.freq, 'freq')} Hz ${show(x.gain)} dB bw ${show(x.bw, 'bw')}${x.enabled ? '' : ' off'}`

function eqChanges(plugin: string, a: Bands, b: Bands): WlChange[] {
  const out: WlChange[] = []
  if (a.length !== b.length) out.push({ plugin, kind: 'bands', field: 'Bands', from: String(a.length), to: String(b.length) })
  for (let k = 0; k < Math.max(a.length, b.length); k++) {
    if (!a[k] || !b[k]) {
      // a band added or removed: one line with the whole band
      out.push({ plugin, kind: 'bands', field: `Band ${k + 1}`, from: a[k] ? bandText(a[k]) : NONE, to: b[k] ? bandText(b[k]) : NONE })
      continue
    }
    for (const [key, label] of BAND_FIELDS) {
      const from = show(a[k]?.[key], key)
      const to = show(b[k]?.[key], key)
      if (from !== to) out.push({ plugin, kind: 'value', field: `Band ${k + 1} ${label}`, from, to })
    }
  }
  return out
}

/** Field-level differences of two decoded states of the same plugin (empty when the shown values are equal). */
export function stateChanges(plugin: string, a: WlPluginState, b: WlPluginState): WlChange[] {
  if (a.kind === 'reaeq' && b.kind === 'reaeq') return eqChanges(plugin, a.bands, b.bands)
  const params = a.kind === 'reagate' && b.kind === 'reagate' ? GATE_PARAMS : a.kind === 'recomp' && b.kind === 'recomp' ? COMP_PARAMS : null
  if (!params) return []
  const av = a as unknown as Record<string, number | boolean>
  const bv = b as unknown as Record<string, number | boolean>
  return params.flatMap((m): WlChange[] => {
    const from = show(av[m.key])
    const to = show(bv[m.key])
    return from === to ? [] : [{ plugin, kind: 'value', field: m.label, from, to }]
  })
}

/**
 * Changes between the plugins before and after, in plugin order, then the missing plugins. A new state shows as
 * its field changes when both sides decode; a restored state that cannot be compared (ReaFIR, Elgato) as 'restore'.
 */
export function describeChanges(before: WlPlugin[], after: WlPlugin[], restored: ReadonlySet<number>, missing: string[]): WlChange[] {
  const out: WlChange[] = []
  before.forEach((p, k) => {
    const q = after[k]
    const plugin = canonicalName(p.name)
    if (q.parameterState !== p.parameterState) {
      const comparable = p.state.kind !== 'opaque' && q.state.kind !== 'opaque'
      const fields = comparable ? stateChanges(plugin, p.state, q.state) : []
      out.push(...fields)
      if (!fields.length && (restored.has(k) || !comparable)) out.push({ plugin, kind: 'restore', field: '', from: '', to: '' })
    }
    if (q.on !== p.on) out.push({ plugin, kind: 'onOff', field: '', from: p.on ? 'on' : 'off', to: q.on ? 'on' : 'off' })
  })
  for (const name of missing) out.push({ plugin: name, kind: 'missing', field: '', from: '', to: '' })
  return out
}
