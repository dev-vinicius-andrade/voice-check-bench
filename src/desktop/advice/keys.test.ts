import { describe, expect, it } from 'vitest'
import en from '../../i18n/locales/en/desktop.json'
import pt from '../../i18n/locales/pt-BR/desktop.json'
import type { Msg } from '../../plain/types'
import type { HeldSide } from '../../live/hold'
import { advise } from './advise'
import { chain, comp, eq, gate, held, noiseRemoval, tone } from './testFixtures'
import { apply, emptyUndo } from './undo'

/** Walks a locale JSON by dotted key; undefined when the path is missing or not a string. */
function lookup(root: unknown, key: string): string | undefined {
  let node: unknown = root
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === 'string' ? node : undefined
}

const placeholders = (s: string): string[] => [...s.matchAll(/\{\{\s*([^,}\s]+)[^}]*\}\}/g)].map((m) => m[1])

/** Every advice the rules can give: each rule, each tone band both ways, and the undo title. */
function collectMsgs(): Msg[] {
  const scenarios: Partial<HeldSide>[] = [
    { speechDb: -10 },
    { speechDb: -20, clipFrames: 2 },
    { speechDb: -32 },
    { deadSilence: 0.3 },
    ...[1, 2, 3, 6, 7].flatMap((b) => [{ tone: tone({ [b]: 6 }) }, { tone: tone({ [b]: -6 }) }]),
  ]
  const chains = [chain(), [noiseRemoval(0), gate({ dryDb: 0 }), eq(), comp(8)], [gate()]]
  const out: Msg[] = []
  for (const fx of scenarios) for (const c of chains) for (const a of advise(held(fx), c)) out.push(a.titleMsg, a.changeMsg)
  const r = apply(emptyUndo(chain()), { id: 'x', reason: 'tooLoud', titleMsg: { key: 'desktop.advice.title.tooLoud' }, kind: 'value', slot: 3, key: 'wetDb', from: 6, to: 2 })
  if (r.ok) out.push(r.inverse.titleMsg)
  return out
}

describe('desktop.advice keys', () => {
  const msgs = collectMsgs()
  const keys = [...new Set(msgs.map((m) => m.key))]

  it('covers every rule', () => {
    const titles = keys.filter((k) => k.includes('.title.'))
    expect(titles).toEqual(
      expect.arrayContaining([
        'desktop.advice.title.gateDoubled',
        'desktop.advice.title.tooLoud',
        'desktop.advice.title.tooQuiet',
        'desktop.advice.title.deadSilence.noiseRemoval',
        'desktop.advice.title.deadSilence.gate',
      ]),
    )
    expect(titles.filter((k) => k.includes('.tone.'))).toHaveLength(10)
    expect(keys).toEqual(expect.arrayContaining(['desktop.advice.change.db', 'desktop.advice.change.eq', 'desktop.advice.change.strength', 'desktop.advice.undo']))
  })

  for (const [name, root] of [
    ['en', en],
    ['pt-BR', pt],
  ] as const) {
    it(`${name}: has a string for every key`, () => {
      expect(keys.filter((k) => lookup(root, k) === undefined)).toEqual([])
    })

    it(`${name}: gets every {{param}} it uses`, () => {
      const problems: string[] = []
      for (const m of msgs) {
        const s = lookup(root, m.key)
        if (s === undefined) continue
        for (const p of placeholders(s)) if (!(m.params && p in m.params)) problems.push(`${m.key}: {{${p}}}`)
      }
      expect(problems).toEqual([])
    })
  }
})
