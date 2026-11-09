// Every results.* key used in the results components (and Term/MsgText) exists in en/results.json.
import { describe, expect, it } from 'vitest'
import plain from '../../i18n/locales/en/plain.json'
import results from '../../i18n/locales/en/results.json'

const sources = {
  ...import.meta.glob('./*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../common/{Term,MsgText}.tsx', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>

/** Walks the locale JSON by dotted key; undefined when the path is missing or not a string. */
function lookup(root: unknown, key: string): string | undefined {
  let node: unknown = root
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === 'string' ? node : undefined
}

const PLURAL_SUFFIXES = ['_one', '_other', '_ordinal_one', '_ordinal_other']
const exists = (key: string): boolean =>
  lookup(results, key) !== undefined || PLURAL_SUFFIXES.some((s) => lookup(results, key + s) !== undefined)

function usedKeys(): string[] {
  const keys = new Set<string>()
  for (const [file, src] of Object.entries(sources)) {
    if (file.includes('.test.')) continue
    for (const m of src.matchAll(/\bt\(\s*'(results\.[^'$]+)'/g)) keys.add(m[1])
    for (const m of src.matchAll(/i18nKey="(results\.[^"]+)"/g)) keys.add(m[1])
  }
  return [...keys]
}

/** Keys built at runtime from a known set of ids (template literals the scan above cannot see). */
const DYNAMIC = [
  ...Array.from({ length: 9 }, (_, i) => `results.band.${i}`),
  ...['quiet', 'hum', 'tonal', 'broadband'].map((k) => `results.noiseKind.${k}`),
  ...['free', 'minutes'].map((k) => `results.next.cost.${k}`),
  ...['good', 'warn', 'bad'].map((k) => `results.checks.${k}`),
  ...['belowQuarter', 'quarter', 'half', 'some', 'little', 'floor'].map((k) => `results.summary.beforeAfter.${k}`),
  ...['quieter', 'thin', 'harsh', 'chopped'].map((k) => `results.regressions.${k}`),
  ...['behind', 'ahead', 'same'].map((k) => `results.summary.community.${k}`),
]

describe('results locale keys', () => {
  it('finds the component sources', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(20)
    expect(usedKeys().length).toBeGreaterThan(50)
  })

  it('has every literal t(\'results.…\') and <Trans i18nKey> key', () => {
    expect(usedKeys().filter((k) => !exists(k))).toEqual([])
  })

  it('has every dynamic results key', () => {
    expect(DYNAMIC.filter((k) => !exists(k))).toEqual([])
  })

  it('has the plain placement and address keys the "Show me how" panel uses', () => {
    const keys = [
      ...['cardioid', 'supercardioid', 'other'].map((k) => `plain.action.placement.${k}`),
      ...['end', 'side', 'unknown'].map((k) => `plain.action.speakInto.${k}`),
    ]
    expect(keys.filter((k) => lookup(plain, k) === undefined)).toEqual([])
  })
})
