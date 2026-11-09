// Every literal guide.* key used in the guide components (and the results entry points) exists in en/guide.json.
import { describe, expect, it } from 'vitest'
import guide from '../../i18n/locales/en/guide.json'
import { HOSTS } from './hostPref'

const SOURCES = {
  ...import.meta.glob('./*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../results/{NextActions,SuggestedSettings}.tsx', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>

const lookup = (key: string): unknown =>
  key.split('.').reduce<unknown>((n, part) => (n !== null && typeof n === 'object' ? (n as Record<string, unknown>)[part] : undefined), guide)

describe('guide i18n keys', () => {
  it('every literal key exists in en/guide.json', () => {
    const keys = new Set<string>()
    for (const [file, src] of Object.entries(SOURCES)) {
      if (file.includes('.test.')) continue
      for (const m of src.matchAll(/['"`](guide\.[A-Za-z0-9_.]+)['"`]/g)) keys.add(m[1])
    }
    expect(keys.size).toBeGreaterThan(40)
    expect([...keys].filter((k) => typeof lookup(k) !== 'string')).toEqual([])
  })

  it('template keys resolve for every id', () => {
    const keys = [
      ...HOSTS.flatMap((h) => [`guide.host.option.${h}.name`, `guide.host.option.${h}.text`]),
      ...['wavelink', 'obs', 'apps'].map((h) => `guide.host.unsure.${h}`),
      ...['setup', 'profile', 'reduce'].flatMap((p) => [`guide.wl.reafir.${p}.title`, `guide.wl.reafir.${p}.lead`]),
      ...['effects', 'ai', 'eqFlat', 'comp', 'gate', 'lowcut', 'listen'].map((k) => `guide.wl.${k}.title`),
      ...['elgato', 'nvidia'].flatMap((k) => ['title', 'a1', 'a2', 'pick'].map((p) => `guide.wl.ai.${k}.${p}`)),
      ...['elgato', 'nvidia', 'reafir'].map((k) => `guide.wl.ai.chosen.${k}`),
      ...['install', 'enable', 'use'].flatMap((k) => [`guide.nvidia.${k}.title`, `guide.nvidia.${k}.lead`]),
    ]
    expect(keys.filter((k) => typeof lookup(k) !== 'string')).toEqual([])
  })
})
