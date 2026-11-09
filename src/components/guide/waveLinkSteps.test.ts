import { describe, expect, it } from 'vitest'
import { suggest } from '../../settings/suggest'
import { SHEET_FIXTURES } from '../../settings/sheetFixtures'
import type { Suggestion } from '../../types'
import { obsValues } from './obsValues'
import { offEffects, waveLinkSteps } from './waveLinkSteps'

const fixture = (name: string): Suggestion => {
  const [take, dist] = SHEET_FIXTURES[name]
  const s = suggest(take, dist)
  if (!s) throw new Error('fixture has no suggestion')
  return s
}

describe('waveLinkSteps', () => {
  it('noisy chain: ReaFIR add + setup/profile/reduce first, one ReaEQ step per band, then comp, gate, low cut, test', () => {
    const s = fixture('noisyCondenserSide')
    expect(s.chain[0]).toBe('ReaFIR')
    const steps = waveLinkSteps(s)
    const ids = steps.map((x) => x.id)
    expect(ids.slice(0, 5)).toEqual(['effects', 'add-ReaFIR', 'reafir-setup', 'reafir-profile', 'reafir-reduce'])
    expect(steps.filter((x) => x.kind === 'eq')).toHaveLength(s.eq.length)
    expect(steps.filter((x) => x.kind === 'eq').map((x) => x.band)).toEqual(s.eq.map((_, i) => i))
    expect(ids.slice(-2)).toEqual(['lowcut', 'test'])
    expect(ids.indexOf('add-ReaGate')).toBeGreaterThan(ids.indexOf('comp'))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('quiet chain: no ReaFIR steps, gate first, ReaEQ sub-steps = bands', () => {
    const s = fixture('quietEq')
    const steps = waveLinkSteps(s)
    expect(steps.some((x) => x.kind === 'reafir' || x.plugin === 'ReaFIR')).toBe(false)
    expect(steps[1]).toMatchObject({ kind: 'add', plugin: 'ReaGate', position: 1 })
    expect(s.eq.length).toBeGreaterThan(0)
    expect(steps.filter((x) => x.kind === 'eq')).toHaveLength(s.eq.length)
  })

  it('no EQ bands: one "nothing to change" step instead', () => {
    const s = { ...fixture('quietEq'), eq: [] }
    const steps = waveLinkSteps(s)
    expect(steps.filter((x) => x.kind === 'eq')).toHaveLength(0)
    expect(steps.filter((x) => x.kind === 'eqFlat')).toHaveLength(1)
  })

  it('keeps the De-Esser on only when the suggestion wants it', () => {
    const s = fixture('quietEq')
    expect(offEffects({ ...s, deess: false })).toContain('Elgato De-Esser')
    expect(offEffects({ ...s, deess: true })).not.toContain('Elgato De-Esser')
    expect(offEffects(s)).toEqual(expect.arrayContaining(['Voice Focus', 'Elgato EQ', 'Elgato Noise Removal']))
  })
})

describe('obsValues', () => {
  it('noisy room: noise suppression + expander, notches flagged', () => {
    const s = fixture('noisyCondenserSide')
    const v = obsValues(s)
    expect(v.noiseSuppression).toBe(true)
    expect(v.gate).toMatchObject({ kind: 'expander', threshold: s.gate.threshold })
    expect(v.hasNotches).toBe(true)
    expect(v.comp).toEqual({ ratio: s.comp.ratio, threshold: s.comp.threshold, attack: s.comp.attack, release: s.comp.release, output: s.comp.wet })
    expect(v.limiter.threshold).toBe(-1)
  })

  it('quiet room: noise gate with close = threshold + hysteresis, 3-band gains from the bands', () => {
    const s = fixture('quietEq')
    const v = obsValues(s)
    expect(v.noiseSuppression).toBe(false)
    expect(v.gate).toMatchObject({ kind: 'gate', open: s.gate.threshold, close: s.gate.threshold + s.gate.hysteresis })
    const lows = s.eq.filter((e) => e.freq < 800).map((e) => e.gain)
    const expected = lows.length ? Math.round((lows.reduce((a, b) => a + b, 0) / lows.length) * 2) / 2 : 0
    expect(v.eq3.low).toBe(expected)
  })
})
