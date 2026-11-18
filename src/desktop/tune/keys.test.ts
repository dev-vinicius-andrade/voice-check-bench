// @vitest-environment node
// Every message the tuner can return has an English and a pt-BR string that gets all the {{params}} it uses, and
// the locale files carry no desktop.autotune reason / unmet string the tuner never returns.
import { describe, expect, it } from 'vitest'
import en from '../../i18n/locales/en/desktop.json'
import pt from '../../i18n/locales/pt-BR/desktop.json'
import type { Msg } from '../../plain/types'
import { comp, eq, gate, noiseRemoval } from '../advice/testFixtures'
import type { ChainSlot } from '../advice/types'
import { fakeRenderer } from './fakeRenderer'
import { BAND_KEYS } from './targets'
import { testTake, type TestTakeOptions } from './testTake'
import { tune } from './tune'
import type { TuneGoals } from './types'

const P = 'desktop.autotune.'
const level = ['from', 'target', 'peak', 'db']
const toneKeys = (['high', 'low'] as const).flatMap((side) => BAND_KEYS.slice(1).map((b) => `reason.tone.${side}.${b}`))

/** Every key the tuner returns, with the params it passes (./stages.ts, ./toneStage.ts, ./tune.ts). */
const ALL: Readonly<Record<string, readonly string[]>> = {
  'reason.level.up': level,
  'reason.level.down': level,
  'reason.level.peaks': level,
  'reason.level.gateFollows': ['db'],
  'reason.trim.up': level,
  'reason.trim.down': level,
  'reason.gateDoubled': ['from', 'to'],
  'reason.dead.gateDry': ['to'],
  'reason.dead.strength': [],
  'reason.dead.threshold': ['db'],
  'reason.noise.strength': ['snr'],
  'reason.noise.threshold': ['to'],
  'reason.noise.onStrength': ['to'],
  'reason.words.times': [],
  'reason.words.threshold': ['to'],
  'reason.words.floor': ['to'],
  'reason.switch.reafirDamage': [],
  'reason.switch.reafirTone': ['lo', 'hi'],
  'reason.switch.nrOn': ['snr'],
  'reason.tone.shape.high': ['lo', 'hi'],
  'reason.tone.shape.low': ['lo', 'hi'],
  ...Object.fromEntries(toneKeys.map((k) => [k, ['db']])),
  'reason.comp.ratio': ['spread', 'to'],
  'reason.comp.threshold': ['spread', 'to'],
  'unmet.notEnoughSpeech': [],
  'unmet.silent': [],
  'unmet.clipped': ['count'],
  'unmet.level.noToolQuiet': ['db'],
  'unmet.level.noToolLoud': ['db'],
  'unmet.level.capQuiet': ['db'],
  'unmet.level.capLoud': ['db'],
  'unmet.level.peaks': ['db'],
  'unmet.level.held': ['db'],
  'unmet.dead': [],
  'unmet.chopped': [],
  'unmet.silentPauses': [],
  'unmet.room.loud': ['snr'],
  'unmet.cut': ['pct', 'events'],
  'unmet.noise.wouldCut': ['snr', 'target'],
  'unmet.noise.noTool': ['snr', 'target'],
  'unmet.noise.limit': ['snr', 'target'],
  'unmet.tone.noEq': [],
  'unmet.tone.noBand': ['lo', 'hi'],
  'unmet.tone.sharpS': ['db'],
  'unmet.tone.limitHigh': ['lo', 'hi', 'db'],
  'unmet.tone.limitLow': ['lo', 'hi', 'db'],
  'unmet.tone.hidden': ['lo', 'hi', 'db', 'maskLo', 'maskHi', 'maskDb'],
  'unmet.tone.alreadyHigh': ['lo', 'hi', 'db'],
  'unmet.tone.alreadyLow': ['lo', 'hi', 'db'],
  'unmet.tone.room': ['db'],
  'unmet.spread.noComp': ['spread', 'target'],
  'unmet.spread.limit': ['spread', 'target'],
  'unmet.budget': ['renders'],
}

type Tree = { [k: string]: string | Tree }

function lookup(root: unknown, key: string): string | undefined {
  let node: unknown = root
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === 'string' ? node : undefined
}

function flatten(tree: Tree, prefix: string, out: string[] = []): string[] {
  for (const [k, v] of Object.entries(tree)) {
    if (typeof v === 'string') out.push(`${prefix}.${k}`)
    else flatten(v, `${prefix}.${k}`, out)
  }
  return out
}

const placeholders = (s: string): string[] => [...s.matchAll(/\{\{\s*([^,}\s]+)[^}]*\}\}/g)].map((m) => m[1])

describe('desktop.autotune keys', () => {
  for (const [name, root] of [
    ['en', en],
    ['pt-BR', pt],
  ] as const) {
    it(`${name}: a string for every key, using only the params the tuner passes`, () => {
      const problems: string[] = []
      for (const [key, params] of Object.entries(ALL)) {
        const s = lookup(root, P + key)
        if (s === undefined) problems.push(`${key}: missing`)
        else for (const p of placeholders(s)) if (!params.includes(p)) problems.push(`${key}: {{${p}}}`)
      }
      expect(problems).toEqual([])
    })

    it(`${name}: the one-line change of a moved ReaEQ band has its string`, () => {
      const s = lookup(root, `${P}change.band`)
      expect(s).toBeDefined()
      expect(placeholders(s ?? '').sort()).toEqual(['band', 'fromDb', 'fromHz', 'fromOct', 'plugin', 'toDb', 'toHz', 'toOct'])
    })

    it(`${name}: no reason / unmet string the tuner never returns`, () => {
      const tree = (root as unknown as { desktop: { autotune: Tree } }).desktop.autotune
      const have = [...flatten(tree.reason as Tree, 'reason'), ...flatten(tree.unmet as Tree, 'unmet')]
      expect(have.filter((k) => !(k in ALL))).toEqual([])
    })
  }

  it('what real runs return is in the list, with those params', async () => {
    const goals = (g: Partial<TuneGoals>): TuneGoals => ({ use: 'streaming', style: 'natural', bothers: [], amount: 'strong', ...g })
    const runs: [Partial<TestTakeOptions>, ChainSlot[], Partial<TuneGoals>, number?][] = [
      [{ speechDb: -34, noiseDb: -48, tone: [0, 7, 4, 0, 0, 0, -5, 5, 0], phraseDb: [0, -10, -2, -12] }, [noiseRemoval(20), gate({ thresholdDb: -60 }), eq(), comp(0)], { bothers: ['boomy', 'roomNoise', 'unevenVolume', 'sharpS', 'muffled'] }],
      [{ speechDb: -10, noiseDb: -45, tone: [0, -20, -7, 5] }, [gate({ thresholdDb: -40, dryDb: 0 }), comp(12)], { bothers: ['thin'] }, 3],
      [{ speechDb: -21, noiseDb: -60, phraseDb: [0, -14] }, [noiseRemoval(85), gate({ thresholdDb: -45, dryDb: -100 }), eq()], {}],
      // a ReaFIR that empties the lows, a Noise Removal sitting switched off in a noisy room, complaints the take contradicts
      [{ speechDb: -21, noiseDb: -47, tone: [0, 0, 8, 0, 0, 3, 4] }, [{ index: 9, kind: 'reafir', name: 'ReaFir (ReaPlugs Edition)', on: true, values: {} }, noiseRemoval(44, false), eq(), comp(8.5)], { bothers: ['lacksPresence', 'lacksClarity', 'thin'], amount: 'light' }],
    ]
    const msgs: Msg[] = []
    for (const [takeOpts, chain, g, maxRenders] of runs) {
      const x = testTake(takeOpts)
      const r = await tune({ take: x, chain, render: fakeRenderer(x, chain).render, goals: goals(g), maxRenders })
      msgs.push(...r.changes.map((c) => c.titleMsg), ...r.unmet)
    }
    expect(msgs.length).toBeGreaterThan(8)
    const problems: string[] = []
    for (const m of msgs) {
      const params = ALL[m.key.slice(P.length)]
      if (!m.key.startsWith(P) || !params) problems.push(`${m.key}: not listed`)
      else for (const p of params) if (!(m.params && p in m.params)) problems.push(`${m.key}: no ${p}`)
    }
    expect(problems).toEqual([])
  }, 60_000)
})
