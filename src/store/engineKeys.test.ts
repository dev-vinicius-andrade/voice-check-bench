// Every message key the framework-free engine returns (diagnose, suggest + settings sheet, quickStats, mic
// catalog, store status lines) exists in en/engine.json and pt-BR/engine.json, both strings use the same
// {{params}}, and the Msg carries every param they use.
import { describe, expect, it } from 'vitest'
import { NOT_ENOUGH_SPEECH_KEY } from '../audio/analyze'
import { diagnose } from '../audio/diagnose'
import { FAILURE_IDS, failureHint, type QuickStats } from '../audio/quickStats'
import { fakeAnalysis } from '../audio/testSignals'
import enEngine from '../i18n/locales/en/engine.json'
import enSuggest from '../i18n/locales/en/suggest.json'
import ptEngine from '../i18n/locales/pt-BR/engine.json'
import ptSuggest from '../i18n/locales/pt-BR/suggest.json'
import { MIC_OTHER_LABEL, addressTip, placementTip } from '../mics/catalog'
import { fixtureAnalyses, voiceAnalysis } from '../plain/testFixtures'
import type { Msg } from '../plain/types'
import { englishText } from '../settings/english'
import { SHEET_FIXTURES } from '../settings/sheetFixtures'
import { suggest, suggestionToText } from '../settings/suggest'
import type { Analysis, MicAddress, MicPattern, Take } from '../types'
import storeSource from './benchStore.ts?raw'

// suggest.json (`suggestx.*`) holds the newer suggestion keys next to engine.json.
const en = { ...enEngine, ...enSuggest }
const pt = { ...ptEngine, ...ptSuggest }

function lookup(tree: unknown, key: string): string | undefined {
  let node = tree
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === 'string' ? node : undefined
}

/** `{{name}}` and `{{name, format}}` placeholder names. */
const placeholders = (s: string): string[] => [...new Set([...s.matchAll(/\{\{\s*([^,}\s]+)[^}]*\}\}/g)].map((m) => m[1]))].sort()

const analyses = (): Analysis[] => [
  ...fixtureAnalyses(),
  ...[0, 1, 2, 3, 4, 5, 6, 7, 8].flatMap((i) => [5, -5, 9, -9].map((d) => voiceAnalysis(i, d))),
  fakeAnalysis({ quietBroken: true, noiseFromQuiet: false, hum: [{ hz: 50, db: 3 }, { hz: 60, db: 8 }], sibP95: -4, peak: -0.5 }),
  fakeAnalysis({ noiseFromQuiet: false, noise: -80 }),
  fakeAnalysis({ noiseFromQuiet: false, noise: -50 }),
  fakeAnalysis({ hum: [{ hz: 50, db: 2 }, { hz: 60, db: 3 }] }),
  fakeAnalysis({ hum: [{ hz: 60, db: 14 }], noise: -80 }),
  fakeAnalysis({ hum: [{ hz: 120, db: 14 }], noise: -50 }),
  ...[1, 2, 3].map((n) => fakeAnalysis({ tones: [{ hz: 780, db: 20 }, { hz: 1560, db: 13 }, { hz: 2000, db: 9 }].slice(0, n) })),
  ...[10, 20, 30].map((v) => fakeAnalysis({ bandSnr: Array(9).fill(v) })),
  // over-processing check (v0.8): good and bad
  fakeAnalysis({ zeroRatio: 0.01, gateSwitches: 2 }),
  fakeAnalysis({ zeroRatio: 0.4, gateSwitches: 23, noise: -100 }),
]

const take = (analysis: Analysis): Take => ({
  id: 1, name: 'Control · 8 cm · raw', session: 's1', step: 'c8', device: 'Mic', sampleRate: 48000,
  samples: new Float32Array(0), created: '2026-01-01T00:00:00.000Z', analysis,
})

/** Store status lines: st('key', { a, b: … }) calls in benchStore.ts, plus st(cond ? 'x' : 'y'). */
function storeMsgs(): Msg[] {
  const out: Msg[] = []
  for (const m of storeSource.matchAll(/\bst\('(\w+)'(?:,\s*\{([^}]*)\})?\)/g)) {
    const names = (m[2] ?? '').split(',').map((p) => p.split(':')[0].trim()).filter(Boolean)
    out.push({ key: `engine.status.${m[1]}`, params: Object.fromEntries(names.map((n) => [n, 1])) })
  }
  for (const m of storeSource.matchAll(/\bst\([^()]*?\? '(\w+)' : '(\w+)'\)/g)) out.push({ key: `engine.status.${m[1]}` }, { key: `engine.status.${m[2]}` })
  return out
}

function collect(): Msg[] {
  const out: Msg[] = []
  for (const a of analyses()) {
    for (const c of diagnose(a)) out.push(c.titleMsg, c.detailMsg, ...(c.valueMsg ? [c.valueMsg] : []), ...(c.fixMsg ? [c.fixMsg] : []))
  }
  const record = (m: Msg): string => {
    out.push(m)
    return englishText(m)
  }
  const sugg = [
    ...Object.values(SHEET_FIXTURES).map(([t, d]) => suggest(t, d)),
    ...analyses().map((a) => suggest(take(a), '8 cm')),
    suggest(take(fakeAnalysis({ snr: 10, noise: -40, speechMed: -40 })), '8 cm', { model: '', kind: 'condenser', pattern: 'omni', address: 'side' }),
  ]
  for (const s of sugg) {
    if (!s) continue
    // the sheet goes through every hint, EQ reason, ReaFIR step and alternative
    suggestionToText(s, record)
  }
  const qs: QuickStats[] = [
    { duration: 5, peakDb: -100, silenceDb: NaN, readingDb: NaN },
    { duration: 5, peakDb: -20, silenceDb: -70, readingDb: -60 },
    { duration: 5, peakDb: -20, silenceDb: -40, readingDb: -30 },
    { duration: 5, peakDb: -20, silenceDb: -70, readingDb: -30 },
  ]
  out.push(...qs.map(failureHint))
  const addresses: MicAddress[] = ['end', 'side', 'unknown']
  const patterns: MicPattern[] = ['cardioid', 'supercardioid', 'omni', 'figure8', 'unknown']
  out.push(MIC_OTHER_LABEL, ...addresses.map((address) => addressTip({ address })), ...patterns.map((pattern) => placementTip({ pattern })))
  out.push(...storeMsgs())
  // keys the components build from engine data
  out.push(
    { key: NOT_ENOUGH_SPEECH_KEY },
    { key: 'engine.takes.sessionGroup', params: { date: '1/1/26' } },
    { key: 'engine.takes.freeGroup' },
    { key: 'engine.mic.mains.label' },
    { key: 'engine.mic.mains.auto' },
    { key: 'engine.mic.mains.hz', params: { hz: 60 } },
  )
  return out
}

describe('engine message keys', () => {
  const msgs = collect()
  const keys = [...new Set(msgs.map((m) => m.key))]

  it('collects keys from every engine module', () => {
    for (const prefix of ['check', 'suggest', 'sheet', 'failure', 'mic', 'status', 'takes', 'analysis']) {
      expect(keys.some((k) => k.startsWith(`engine.${prefix}.`)), prefix).toBe(true)
    }
    expect(keys.filter((k) => k.startsWith('engine.failure.'))).toHaveLength(FAILURE_IDS.length)
    expect(keys.filter((k) => k.startsWith('engine.status.')).length).toBeGreaterThanOrEqual(10)
  })

  it('exist in en and pt-BR', () => {
    expect(keys.filter((k) => lookup(en, k) === undefined)).toEqual([])
    expect(keys.filter((k) => lookup(pt, k) === undefined)).toEqual([])
  })

  it('use the same {{params}} in both languages, all provided by the message', () => {
    const problems: string[] = []
    for (const m of msgs) {
      const e = lookup(en, m.key)
      const p = lookup(pt, m.key)
      if (e === undefined || p === undefined) continue
      if (placeholders(e).join() !== placeholders(p).join()) problems.push(`${m.key}: en {${placeholders(e)}} pt {${placeholders(p)}}`)
      const missing = placeholders(e).filter((n) => m.params?.[n] === undefined)
      if (missing.length) problems.push(`${m.key}: missing ${missing.join(', ')}`)
    }
    expect([...new Set(problems)]).toEqual([])
  })

  it('has no unused keys in en/engine.json and en/suggest.json', () => {
    const flat = (tree: unknown, prefix: string): string[] =>
      Object.entries(tree as Record<string, unknown>).flatMap(([k, v]) => (typeof v === 'string' ? [`${prefix}${k}`] : flat(v, `${prefix}${k}.`)))
    expect(flat(en, '').filter((k) => !keys.includes(k))).toEqual([])
  })
})
