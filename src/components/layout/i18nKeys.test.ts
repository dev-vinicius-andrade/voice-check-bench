// Every common/wizard/pages key the site, setup and step screens use exists in the English source files.
import { describe, expect, it } from 'vitest'
import common from '../../i18n/locales/en/common.json'
import pages from '../../i18n/locales/en/pages.json'
import wizard from '../../i18n/locales/en/wizard.json'
import { STEPS, STEP_PARTS, stepKey, stepText } from '../../session/steps'
import { APPLY, CHAIN, HOME_STEPS, MEASURES, PRIVACY_LOCAL, ROOM_TIPS, SHARE_STEPS, TAKES } from '../pages/howItWorksData'
import { ADDRESSES, KINDS, PATTERNS } from '../setup/micOptions'

const EN: Record<string, unknown> = { ...common, ...wizard, ...pages }

/** String at a dotted path (or its i18next plural forms); undefined when missing. */
function lookup(key: string): string | undefined {
  const walk = (k: string): unknown =>
    k.split('.').reduce<unknown>((n, part) => (n !== null && typeof n === 'object' ? (n as Record<string, unknown>)[part] : undefined), EN)
  const v = walk(key)
  if (typeof v === 'string') return v
  const other = walk(`${key}_other`)
  return typeof other === 'string' ? other : undefined
}

const SOURCES = {
  ...import.meta.glob('../{setup,step,pages,layout}/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../common/{LevelMeter,DeviceSelect,TwoToneHeading}.tsx', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../../App.tsx', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>

/** Whole-key string literals ('wizard.x.y', "pages.a", `common.b`) — template keys with ${…} are checked below. */
function literalKeys(): Map<string, string> {
  const out = new Map<string, string>()
  for (const [file, src] of Object.entries(SOURCES)) {
    if (file.endsWith('.test.ts')) continue
    for (const m of src.matchAll(/['"`]((?:common|wizard|pages)\.[A-Za-z0-9_.]+)['"`]/g)) out.set(m[1], file)
  }
  return out
}

describe('i18n keys used by setup, step, pages and layout', () => {
  it('finds the source files', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(20)
  })

  it('every literal key exists in the en JSON', () => {
    const keys = literalKeys()
    expect(keys.size).toBeGreaterThan(80)
    const missing = [...keys].filter(([k]) => lookup(k) === undefined).map(([k, f]) => `${k} (${f})`)
    expect(missing).toEqual([])
  })

  it('every step part resolves, with the distance filled in', () => {
    for (const st of STEPS) {
      for (const part of STEP_PARTS) expect(lookup(stepKey(st, part)), stepKey(st, part)).toBeTypeOf('string')
      const text = stepText(st, (k, p) => (lookup(k) ?? k).replace('{{dist}}', String(p?.dist)), '8 cm')
      expect(text.lead).not.toContain('wizard.')
      expect(text.title).toContain('8 cm')
    }
  })

  // mic tips and failure hints are engine messages: see src/store/engineKeys.test.ts
  it('mic options resolve', () => {
    const keys: string[] = []
    for (const [group, values] of [['kind', KINDS], ['pattern', PATTERNS], ['address', ADDRESSES]] as const) {
      keys.push(`wizard.mic.${group}Label`)
      for (const v of values) keys.push(`wizard.mic.${group}.${v}`, `wizard.mic.${group}Help.${v}`)
    }
    for (const kind of ['raw', 'fx']) keys.push(`wizard.access.${kind}.title`, `wizard.access.${kind}.hint`)
    expect(keys.filter((k) => lookup(k) === undefined)).toEqual([])
  })

  it('page list items resolve', () => {
    const keys = [
      ...MEASURES.flatMap((id) => [`pages.how.measures.${id}.term`, `pages.how.measures.${id}.def`]),
      ...CHAIN.flatMap((id) => [`pages.how.chain.${id}.role`, `pages.how.chain.${id}.def`]),
      ...ROOM_TIPS.map((id) => `pages.how.tips.${id}`),
      ...TAKES.map((id) => `pages.how.takes.${id}`),
      ...APPLY.map((id) => `pages.how.apply.${id}`),
      ...PRIVACY_LOCAL.map((id) => `pages.privacy.local.${id}`),
      ...HOME_STEPS.flatMap((id) => [`pages.home.steps.${id}.title`, `pages.home.steps.${id}.sub`]),
      ...['rooms', 'owners', 'private'].flatMap((id) => [`pages.home.features.${id}.title`, `pages.home.features.${id}.text`]),
      ...SHARE_STEPS.map((id) => `pages.community.share.${id}`),
    ]
    expect(keys.filter((k) => lookup(k) === undefined)).toEqual([])
  })
})
