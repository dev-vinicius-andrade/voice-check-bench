import { describe, expect, it } from 'vitest'
import { suggest } from '../../settings/suggest'
import { SHEET_FIXTURES } from '../../settings/sheetFixtures'
import type { Suggestion } from '../../types'
import { obsValues } from './obsValues'
import { guideChain, offEffects, waveLinkSteps } from './waveLinkSteps'

const fixture = (name: string): Suggestion => {
  const [take, dist] = SHEET_FIXTURES[name]
  const s = suggest(take, dist)
  if (!s) throw new Error('fixture has no suggestion')
  return s
}

describe('waveLinkSteps', () => {
  it('noisy chain: ReaFIR add + setup/profile/reduce first, one ReaEQ step per band, then comp, gate, low cut, listen check, test', () => {
    const s = fixture('noisyCondenserSide')
    expect(s.chain[0]).toBe('ReaFIR')
    const steps = waveLinkSteps(s)
    const ids = steps.map((x) => x.id)
    expect(ids.slice(0, 5)).toEqual(['effects', 'add-ReaFIR', 'reafir-setup', 'reafir-profile', 'reafir-reduce'])
    expect(steps.filter((x) => x.kind === 'eq')).toHaveLength(s.eq.length)
    expect(steps.filter((x) => x.kind === 'eq').map((x) => x.band)).toEqual(s.eq.map((_, i) => i))
    expect(s.noiseReduction?.preferAi).toBe(false)
    expect(ids).not.toContain('ai')
    expect(ids.slice(-3)).toEqual(['lowcut', 'listen', 'test'])
    expect(ids.indexOf('add-ReaGate')).toBeGreaterThan(ids.indexOf('comp'))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('quiet chain: no ReaFIR steps, gate first, ReaEQ sub-steps = bands', () => {
    const s = fixture('quietEq')
    const steps = waveLinkSteps(s)
    expect(steps.map((x) => x.id).slice(-2)).toEqual(['lowcut', 'test'])
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

describe('waveLinkSteps when AI noise removal comes first (preferAi)', () => {
  const s = fixture('noisyLoud')

  it('inserts the AI step before the ReaFIR steps', () => {
    expect(s.noiseReduction?.preferAi).toBe(true)
    const ids = waveLinkSteps(s).map((x) => x.id)
    expect(ids.slice(0, 4)).toEqual(['effects', 'ai', 'add-ReaFIR', 'reafir-setup'])
    expect(waveLinkSteps(s, 'reafir').map((x) => x.id)).toEqual(ids)
  })

  it('choosing Elgato Noise Removal keeps it on, first, and skips ReaFIR', () => {
    expect(offEffects(s, 'ai-elgato')).not.toContain('Elgato Noise Removal')
    expect(guideChain(s, 'ai-elgato')).toEqual(['Elgato Noise Removal', 'ReaEQ', 'ReaComp', 'ReaGate'])
    const steps = waveLinkSteps(s, 'ai-elgato')
    expect(steps.some((x) => x.plugin === 'ReaFIR' || x.kind === 'reafir')).toBe(false)
    expect(steps.find((x) => x.id === 'add-ReaEQ')?.position).toBe(2)
    expect(steps.some((x) => x.id === 'add-Elgato Noise Removal')).toBe(false)
  })

  it('NVIDIA Broadcast skips ReaFIR and keeps Elgato Noise Removal off; ReaFIR switches it off', () => {
    expect(offEffects(s, 'ai-nvidia')).toContain('Elgato Noise Removal')
    expect(guideChain(s, 'ai-nvidia')).toEqual(['ReaEQ', 'ReaComp', 'ReaGate'])
    expect(offEffects(s, 'reafir')).toContain('Elgato Noise Removal')
    // before the choice it is not switched off (the AI step may turn it on)
    expect(offEffects(s, null)).not.toContain('Elgato Noise Removal')
  })

  it('ignores a saved choice when AI noise removal is not suggested first', () => {
    const calm = fixture('noisyCondenserSide')
    expect(guideChain(calm, 'ai-elgato')).toEqual(calm.chain)
    expect(offEffects(calm, 'ai-elgato')).toContain('Elgato Noise Removal')
    expect(waveLinkSteps(calm, 'ai-elgato').some((x) => x.kind === 'ai')).toBe(false)
  })

  it('ends with the listen check before the test', () => {
    expect(waveLinkSteps(s, 'ai-elgato').map((x) => x.id).slice(-2)).toEqual(['listen', 'test'])
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
