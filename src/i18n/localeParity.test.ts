// Every area file in en/ has a pt-BR twin with the same keys (plural forms per locale), the same {{params}}, and no empty strings.
import { describe, expect, it } from 'vitest'

type Tree = { [k: string]: string | Tree }

const load = (glob: Record<string, unknown>): Record<string, Tree> =>
  Object.fromEntries(Object.entries(glob).map(([path, mod]) => [path.split('/').pop()!.replace('.json', ''), mod as Tree]))
const EN = load(import.meta.glob('./locales/en/*.json', { eager: true, import: 'default' }))
const PT = load(import.meta.glob('./locales/pt-BR/*.json', { eager: true, import: 'default' }))

/** Flattens a tree to dotted keys → string values. */
function flatten(tree: Tree, prefix = '', out = new Map<string, string>()): Map<string, string> {
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') out.set(key, v)
    else flatten(v, key, out)
  }
  return out
}

const PLURAL = /_(ordinal_)?(zero|one|two|few|many|other)$/
const baseOf = (key: string): string => key.replace(PLURAL, '')
const isOrdinal = (key: string): boolean => /_ordinal_[a-z]+$/.test(key)
const params = (s: string): string[] => [...new Set([...s.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]))].sort()

/** Base key → { forms, params of every form } for one locale file. */
function groups(flat: Map<string, string>): Map<string, { forms: Set<string>; ordinal: boolean; params: string[] }> {
  const out = new Map<string, { forms: Set<string>; ordinal: boolean; params: string[] }>()
  for (const [key, value] of flat) {
    const base = baseOf(key)
    const g = out.get(base) ?? { forms: new Set<string>(), ordinal: isOrdinal(key), params: [] }
    const form = PLURAL.exec(key)?.[2]
    if (form) g.forms.add(form)
    g.params = [...new Set([...g.params, ...params(value)])].sort()
    out.set(base, g)
  }
  return out
}

const categories = (locale: string, ordinal: boolean): string[] =>
  [...new Intl.PluralRules(locale, { type: ordinal ? 'ordinal' : 'cardinal' }).resolvedOptions().pluralCategories].sort()

describe('en and pt-BR locale files match', () => {
  it('have the same area files', () => {
    expect(Object.keys(EN).length).toBeGreaterThan(4)
    expect(Object.keys(PT).sort()).toEqual(Object.keys(EN).sort())
  })

  for (const area of Object.keys(EN)) {
    describe(area, () => {
      const en = flatten(EN[area])
      const pt = flatten(PT[area] ?? {})
      const enG = groups(en)
      const ptG = groups(pt)

      it('same keys both ways (plural forms compared by base key)', () => {
        expect([...ptG.keys()].filter((k) => !enG.has(k)), 'only in pt-BR').toEqual([])
        expect([...enG.keys()].filter((k) => !ptG.has(k)), 'missing in pt-BR').toEqual([])
      })

      it('same {{params}} for every key', () => {
        const diff = [...enG]
          .filter(([k, g]) => ptG.has(k) && ptG.get(k)!.params.join() !== g.params.join())
          .map(([k, g]) => `${k}: en [${g.params.join()}] pt-BR [${ptG.get(k)!.params.join()}]`)
        expect(diff).toEqual([])
      })

      it('keys with {{count}} have every plural form each locale needs', () => {
        const problems: string[] = []
        for (const [locale, gs] of [['en', enG], ['pt-BR', ptG]] as const) {
          for (const [k, g] of gs) {
            if (!g.params.includes('count')) continue
            const missing = categories(locale, g.ordinal).filter((c) => !g.forms.has(c))
            if (missing.length) problems.push(`${locale} ${k}: missing ${missing.join(', ')}`)
          }
        }
        expect(problems).toEqual([])
      })

      it('no empty strings', () => {
        const empty = [...[...en].map(([k, v]) => ['en', k, v]), ...[...pt].map(([k, v]) => ['pt-BR', k, v])]
          .filter(([, , v]) => v.trim() === '')
          .map(([l, k]) => `${l} ${k}`)
        expect(empty).toEqual([])
      })
    })
  }
})
