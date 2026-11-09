// English text of engine messages for locale-neutral exports (settings sheet, settings JSON). Pure, no i18next:
// reads src/i18n/locales/en/engine.json (+ suggest.json, `suggestx.*`) and fills `{{name}}` / `{{name, number(…)}}` placeholders the way the
// pre-i18n code did (toFixed, '+' for positive signed values, no digit grouping), so exports stay byte-identical.
import engine from '../i18n/locales/en/engine.json'
import suggestx from '../i18n/locales/en/suggest.json'
import type { Msg } from '../plain/types'

const en = { ...engine, ...suggestx }

/** Renders a Msg to text: useMsg() in the UI, englishText for exports. */
export type MsgTranslator = (m: Msg) => string

function lookup(key: string): string | undefined {
  let node: unknown = en
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === 'string' ? node : undefined
}

/** `minimumFractionDigits: 1; signDisplay: exceptZero` → { minimumFractionDigits: '1', signDisplay: 'exceptZero' }. */
function parseOptions(s: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of s.split(';')) {
    const [k, ...rest] = part.split(':')
    if (k.trim()) out[k.trim()] = rest.join(':').trim()
  }
  return out
}

function formatValue(v: string | number, format: string | undefined): string {
  const m = format?.match(/^number\s*(?:\((.*)\))?$/)
  if (typeof v !== 'number' || !m) return String(v)
  const o = parseOptions(m[1] ?? '')
  const digits = o.maximumFractionDigits === undefined ? undefined : Number(o.maximumFractionDigits)
  const sign = o.signDisplay === 'exceptZero' && v > 0 ? '+' : ''
  return sign + (digits === undefined ? String(v) : v.toFixed(digits))
}

/** English text of a message; the key itself when it is missing (as i18next does). */
export const englishText: MsgTranslator = (msg) => {
  const s = lookup(msg.key)
  if (s === undefined) return msg.key
  return s.replace(/\{\{\s*([^,}\s]+)\s*(?:,\s*([^}]*?))?\s*\}\}/g, (all, name: string, format: string | undefined) => {
    const v = msg.params?.[name]
    return v === undefined ? all : formatValue(v, format)
  })
}
