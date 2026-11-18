import { describe, expect, it } from 'vitest'
import en from '../../i18n/locales/en/desktop.json'
import pt from '../../i18n/locales/pt-BR/desktop.json'
import { calReasonMsg, doMsg, noteMsg, noticeMsg } from './msgs'

function lookup(root: unknown, key: string): string | undefined {
  let node: unknown = root
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === 'string' ? node : undefined
}

const placeholders = (s: string): string[] => [...s.matchAll(/\{\{\s*([^,}\s]+)[^}]*\}\}/g)].map((m) => m[1]).sort()

/** Every string key under a subtree. */
function keysOf(node: unknown, prefix: string): string[] {
  if (typeof node === 'string') return [prefix]
  if (node === null || typeof node !== 'object') return []
  return Object.entries(node).flatMap(([k, v]) => keysOf(v, `${prefix}.${k}`))
}

describe('desktop.tune.calibrate keys', () => {
  it('every message the calibration builds exists in en and pt-BR with the same params', () => {
    const msgs = [
      ...(['nrOn', 'strength', 'firOff', 'gate', 'words', 'pumping', 'more', 'less', 'back'] as const).map((k) => calReasonMsg(k)),
      ...(['quiet', 'quietSet', 'talk', 'talkAgain'] as const).map((k) => doMsg(k)),
      ...(['talkedQuiet', 'talkedSet', 'noSpeech', 'gap', 'cancelled', 'undone', 'engineStopped', 'backedOff'] as const).map((k) => noticeMsg(k)),
      ...(['nothing', 'alreadySilent', 'notReached', 'noHelp', 'wordsFirst', 'wouldCut', 'moreCuts', 'morePumps', 'keptReafir'] as const).map((k) => noteMsg(k)),
      noteMsg('noiseBetween', { db: 14 }),
    ]
    for (const m of msgs) {
      const e = lookup(en, m.key)
      const p = lookup(pt, m.key)
      expect(e, m.key).toBeTypeOf('string')
      expect(p, m.key).toBeTypeOf('string')
      expect(placeholders(e ?? '')).toEqual(Object.keys(m.params ?? {}).sort())
      expect(placeholders(p ?? '')).toEqual(placeholders(e ?? ''))
    }
  })

  it('the card strings are the same set in both languages, with the same placeholders', () => {
    const e = keysOf(en.desktop.tune.calibrate, 'desktop.tune.calibrate')
    const p = keysOf(pt.desktop.tune.calibrate, 'desktop.tune.calibrate')
    expect(p).toEqual(e)
    for (const k of e) expect(placeholders(lookup(pt, k) ?? ''), k).toEqual(placeholders(lookup(en, k) ?? ''))
    for (const k of ['calibrate', 'calibrateHint']) expect(lookup(pt, `desktop.autotune.ui.result.${k}`)).toBeTypeOf('string')
  })
})
