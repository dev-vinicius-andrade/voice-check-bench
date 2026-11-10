// Every live.* key used by the live components exists in en/live.json, and en and pt-BR have the same live.* keys.
import { describe, expect, it } from 'vitest'
import en from '../../i18n/locales/en/live.json'
import pt from '../../i18n/locales/pt-BR/live.json'
import type { LiveError } from '../../live/types'

const sources = import.meta.glob('./*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const PLURAL = /_(zero|one|two|few|many|other)$/

type Tree = { [k: string]: string | Tree }
function flatten(tree: Tree, prefix = '', out = new Set<string>()): Set<string> {
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') out.add(key.replace(PLURAL, ''))
    else flatten(v, key, out)
  }
  return out
}
const EN = flatten(en as Tree)
const PT = flatten(pt as Tree)

describe('live i18n keys', () => {
  it('every static live.* key in the components exists', () => {
    const used = new Set<string>()
    for (const [file, src] of Object.entries(sources)) {
      if (file.includes('.test.')) continue
      for (const m of src.matchAll(/\bt\(\s*'(live\.[^'$]+)'/g)) used.add(m[1])
    }
    expect(used.size).toBeGreaterThan(20)
    expect([...used].filter((k) => !EN.has(k))).toEqual([])
  })

  it('has a message for every LiveError and every level word', () => {
    const errors: LiveError[] = ['unsupported', 'permission', 'rawUnavailable', 'fxUnavailable', 'sameDevice', 'other']
    for (const e of errors) expect(EN.has(`live.error.${e}`), e).toBe(true)
    for (const w of ['quiet', 'good', 'loud', 'none']) expect(EN.has(`live.loudness.word.${w}`), w).toBe(true)
  })

  it('en and pt-BR have the same live.* keys', () => {
    expect([...EN].filter((k) => !PT.has(k))).toEqual([])
    expect([...PT].filter((k) => !EN.has(k))).toEqual([])
  })
})
