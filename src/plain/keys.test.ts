import { describe, expect, it } from 'vitest'
import en from '../i18n/locales/en.json'
import type { MicAddress, MicPattern } from '../types'
import { nextActions } from './actions'
import { everydayDistance } from './distances'
import { GLOSSARY, GLOSSARY_IDS } from './glossary'
import { plainRatings, ratingTitle } from './ratings'
import { clarityScore } from './score'
import { fixtureAnalyses, mic } from './testFixtures'
import type { Msg } from './types'

/** Walks the locale JSON by dotted key; undefined when the path is missing or not a string. */
function lookup(key: string): string | undefined {
  let node: unknown = en
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === 'string' ? node : undefined
}

/** `{{name}}` and `{{name, format}}` placeholders in an i18next string. */
const placeholders = (s: string): string[] => [...s.matchAll(/\{\{\s*([^,}\s]+)[^}]*\}\}/g)].map((m) => m[1])

function collectMsgs(): Msg[] {
  const out: Msg[] = []
  const patterns: MicPattern[] = ['cardioid', 'supercardioid', 'omni', 'figure8', 'unknown']
  const addresses: MicAddress[] = ['end', 'side', 'unknown']
  for (const a of fixtureAnalyses()) {
    const s = clarityScore(a)
    out.push(s.headline, s.explain)
    for (const r of plainRatings(a)) out.push(ratingTitle(r.id), r.label, r.explain)
    for (const pattern of patterns) {
      for (const address of addresses) {
        for (const currentDist of ['2 cm', '8 cm', '15 cm', null]) {
          for (const hasSuggestion of [true, false]) {
            for (const x of nextActions(a, { mic: mic({ pattern, address }), currentDist, bestDist: '8 cm', hasSuggestion })) out.push(x.text)
          }
        }
      }
    }
  }
  for (const g of GLOSSARY) out.push(g.term, g.meaning, g.analogy)
  for (const d of ['2 cm', '8 cm', '15 cm', '30 cm']) out.push(everydayDistance(d))
  return out
}

describe('en.json plain namespace', () => {
  const msgs = collectMsgs()
  const keys = [...new Set(msgs.map((m) => m.key))]

  it('has a string for every key the engine returns', () => {
    const missing = keys.filter((k) => lookup(k) === undefined)
    expect(missing).toEqual([])
  })

  it('gets every {{param}} it uses', () => {
    const problems: string[] = []
    for (const m of msgs) {
      const s = lookup(m.key)
      if (s === undefined) continue
      for (const p of placeholders(s)) if (!(m.params && p in m.params)) problems.push(`${m.key}: {{${p}}}`)
    }
    expect(problems).toEqual([])
  })

  it('covers the whole glossary and every rating/action key family', () => {
    expect(GLOSSARY.map((g) => g.id)).toEqual([...GLOSSARY_IDS])
    for (const family of [
      'plain.score.clear', 'plain.score.good', 'plain.score.ok.noise', 'plain.score.ok.level', 'plain.score.ok.tone', 'plain.score.hard.noise',
      'plain.score.hard.level', 'plain.score.hard.tone',
      'plain.rating.noise.label.quiet', 'plain.rating.noise.label.noticeable', 'plain.rating.noise.label.loud',
      'plain.rating.noise.explain.tonal', 'plain.rating.noise.explain.hum', 'plain.rating.noise.explain.broadband', 'plain.rating.noise.explain.quiet',
      'plain.rating.volume.label.distorting', 'plain.rating.volume.label.tooQuiet', 'plain.rating.volume.label.tooLoud', 'plain.rating.volume.label.good',
      'plain.rating.voice.label.natural', 'plain.rating.voice.label.mild.thin', 'plain.rating.voice.label.strong.sharpS',
      'plain.action.placement.cardioid', 'plain.action.placement.supercardioid', 'plain.action.placement.other',
      'plain.action.speakInto.end', 'plain.action.speakInto.side', 'plain.action.speakInto.unknown',
      'plain.action.moveCloser', 'plain.action.fans', 'plain.action.noiseReduction', 'plain.action.gainUp', 'plain.action.gainDown',
      'plain.action.backOff', 'plain.action.angleMic', 'plain.action.eqSettings', 'plain.action.usbPort',
      'plain.distance.finger', 'plain.distance.fist', 'plain.distance.hand', 'plain.distance.other',
    ]) expect(keys, family).toContain(family)
  })

  it('avoids "simply", "just" and "easy" in the copy', () => {
    expect(JSON.stringify(en)).not.toMatch(/\b(simply|just|easy|easily)\b/i)
  })
})
