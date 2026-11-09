import { describe, expect, it } from 'vitest'
import { WlParseError, applyPlan, micInputKey, parseSettings, serialize } from './codec'
import { b64encode } from './fxp'
import { parseTree } from './json'
import { bankBlob, compValues, fixturePlugins, settingsText, suggestionFixture } from './testFixtures'
import type { WlFile, WlPluginState } from './types'

const MIC = 'DS1\\PCM_IN_01_C_00_SD1'
const plugin = (f: WlFile, key: string, name: string) => f.inputs.find((i) => i.key === key)!.plugins.find((p) => p.name.startsWith(name))!
const changedLines = (a: string, b: string) => {
  const la = a.split('\r\n')
  const lb = b.split('\r\n')
  expect(lb).toHaveLength(la.length)
  return lb.filter((l, k) => l !== la[k])
}

describe('parseSettings', () => {
  it('finds the mic input first, decodes ReaPlugs and keeps the rest opaque', () => {
    const f = parseSettings(settingsText())
    expect(f.inputs.map((i) => i.key)).toEqual([MIC]) // the empty output channel is left out
    expect(micInputKey(f)).toBe(MIC)
    expect(f.inputs[0].label).toBe('Wave XLR')
    const names = f.inputs[0].plugins.map((p) => [p.index, p.name, p.on, p.state.kind])
    expect(names).toEqual([
      [0, 'Elgato EQ', true, 'opaque'],
      [1, 'ReaGate (ReaPlugs Edition)', true, 'reagate'],
      [2, 'ReaEQ (ReaPlugs Edition)', true, 'reaeq'],
      [3, 'ReaComp (ReaPlugs Edition)', true, 'recomp'],
      [4, 'Elgato De-Esser', false, 'opaque'],
    ])
    expect(plugin(f, MIC, 'ReaGate').state).toMatchObject({ threshold: expect.closeTo(-40, 4) })
  })

  it('throws coded errors for non-JSON and non-Wave Link files', () => {
    const code = (text: string) => {
      try {
        parseSettings(text)
      } catch (e) {
        return e instanceof WlParseError ? e.code : 'other'
      }
      return 'ok'
    }
    expect(code('not json')).toBe('notJson')
    expect(code('{"a": 1}')).toBe('notWaveLink')
    expect(code('{"MixerConfiguration": {"InputSettings": {"x": {}}}}')).toBe('notWaveLink')
  })

  it('keeps an undecodable ReaPlugs blob opaque', () => {
    const plugins = fixturePlugins()
    plugins[1].state = 'Q2NuSw=='
    expect(plugin(parseSettings(settingsText(plugins)), MIC, 'ReaGate').state.kind).toBe('opaque')
  })
})

describe('serialize', () => {
  it('writes an unmodified tree byte-identically', () => {
    const text = settingsText()
    const f = parseSettings(text)
    expect(serialize(f, parseTree(text))).toBe(text)
  })
})

describe('applyPlan', () => {
  it('writes suggestion values into the existing plugins and lists the changes', () => {
    const f = parseSettings(settingsText())
    const r = applyPlan(f, { inputKey: MIC, suggestion: suggestionFixture() })
    expect(r.missing).toEqual([])
    const after = parseSettings(r.text)
    expect(plugin(after, MIC, 'ReaGate').state).toEqual({
      kind: 'reagate',
      threshold: expect.closeTo(-60, 4),
      attack: expect.closeTo(1, 4),
      hold: expect.closeTo(150, 3),
      release: expect.closeTo(200, 3),
      hysteresis: expect.closeTo(-6, 4),
      wet: expect.closeTo(0, 4),
      dry: expect.closeTo(-20, 4),
    })
    expect(plugin(after, MIC, 'ReaComp').state).toMatchObject({ threshold: expect.closeTo(-34, 4), ratio: expect.closeTo(3, 4), wet: expect.closeTo(12, 4), limit: true })
    const eq = plugin(after, MIC, 'ReaEQ').state as Extract<WlPluginState, { kind: 'reaeq' }>
    expect(eq.bands.map((b) => [b.type, b.freq, +b.gain.toFixed(6), b.bw, b.enabled])).toEqual([
      ['Low Shelf', 150, -4, 2, true],
      ['Band', 1000, 3, 1.5, true],
      ['Band', 4000, 3, 1.4, true],
      ['High Shelf', 10000, 1, 2, true],
    ])
    expect(r.changes).toContainEqual({ plugin: 'ReaGate', kind: 'value', field: 'Threshold (dB)', from: '-40', to: '-60' })
    expect(r.changes).toContainEqual({ plugin: 'ReaEQ', kind: 'bands', field: 'Bands', from: '2', to: '4' })
    expect(r.changes).toContainEqual({ plugin: 'ReaEQ', kind: 'value', field: 'Band 2 Gain (dB)', from: '2', to: '3' })
    expect(r.changes).toContainEqual({ plugin: 'ReaEQ', kind: 'bands', field: 'Band 3', from: '—', to: 'Band 4000 Hz 3 dB bw 1.4' })
    expect(r.changes).toContainEqual({ plugin: 'ReaComp', kind: 'value', field: 'Limit output', from: 'off', to: 'on' })
    expect(r.changes.some((c) => c.field === 'Band 1 Frequency (Hz)')).toBe(false) // unchanged values are not listed
    // only the three ParameterState lines changed; formatting kept
    expect(changedLines(f.text, r.text).every((l) => l.trimStart().startsWith('"ParameterState"'))).toBe(true)
    expect(changedLines(f.text, r.text)).toHaveLength(3)
  })

  it('switches effects on/off, follows deess, and reports missing plugins', () => {
    const f = parseSettings(settingsText())
    const r = applyPlan(f, {
      inputKey: MIC,
      suggestion: suggestionFixture({ deess: true, chain: ['ReaFIR', 'ReaEQ', 'ReaComp', 'ReaGate'] }),
      switchOff: ['Elgato EQ', 'Voice Focus'],
      switchOn: ['Elgato Noise Removal'],
    })
    expect(r.missing).toEqual(['ReaFIR', 'Elgato Noise Removal'])
    expect(r.changes).toContainEqual({ plugin: 'Elgato EQ', kind: 'onOff', field: '', from: 'on', to: 'off' })
    expect(r.changes).toContainEqual({ plugin: 'Elgato De-Esser', kind: 'onOff', field: '', from: 'off', to: 'on' })
    expect(r.changes.filter((c) => c.kind === 'missing').map((c) => c.plugin)).toEqual(['ReaFIR', 'Elgato Noise Removal'])
    const after = parseSettings(r.text).inputs[0].plugins
    expect(after.map((p) => p.on)).toEqual([false, true, true, true, true])
  })

  it('restores exact states verbatim, after the suggestion values', () => {
    const f = parseSettings(settingsText())
    const comp = compValues()
    comp[0] = 0.5
    const state = b64encode(bankBlob(comp))
    const r = applyPlan(f, { inputKey: MIC, suggestion: suggestionFixture(), restoreStates: { ReaComp: state, 'Elgato EQ': 'AAAA', ReaFIR: 'AAAA' } })
    const after = parseSettings(r.text)
    expect(plugin(after, MIC, 'ReaComp').parameterState).toBe(state)
    expect(plugin(after, MIC, 'Elgato EQ').parameterState).toBe('AAAA')
    expect(r.missing).toEqual(['ReaFIR'])
    expect(r.changes).toContainEqual({ plugin: 'Elgato EQ', kind: 'restore', field: '', from: '', to: '' })
    expect(r.changes).toContainEqual({ plugin: 'ReaComp', kind: 'value', field: 'Threshold (dB)', from: '-20', to: '-6' })
  })

  it('returns the original text and no changes when nothing changes', () => {
    const text = settingsText()
    const f = parseSettings(text)
    const r = applyPlan(f, { inputKey: MIC, switchOff: ['Elgato De-Esser'], restoreStates: { ReaGate: plugin(f, MIC, 'ReaGate').parameterState } })
    expect(r).toEqual({ text, changes: [], missing: [] })
  })

  it('refuses unknown inputs, invalid suggestions and blobs it cannot re-encode', () => {
    const f = parseSettings(settingsText())
    expect(() => applyPlan(f, { inputKey: 'nope' })).toThrow(/not found/)
    const bad = suggestionFixture()
    bad.gate.threshold = 12
    expect(() => applyPlan(f, { inputKey: MIC, suggestion: bad })).toThrow(/invalid suggestion/)
    const plugins = fixturePlugins()
    plugins[1].state = 'Q2NuSw=='
    const g = parseSettings(settingsText(plugins))
    expect(() => applyPlan(g, { inputKey: MIC, suggestion: suggestionFixture() })).toThrow(/ReaGate/)
    // a restore of that plugin is still possible (verbatim)
    expect(applyPlan(g, { inputKey: MIC, restoreStates: { ReaGate: fixturePlugins()[1].state } }).changes[0]).toMatchObject({ plugin: 'ReaGate', kind: 'restore' })
  })

  it('keeps one flat band when the suggestion has no EQ bands', () => {
    const f = parseSettings(settingsText())
    const r = applyPlan(f, { inputKey: MIC, suggestion: suggestionFixture({ eq: [] }) })
    const eq = plugin(parseSettings(r.text), MIC, 'ReaEQ').state
    expect(eq).toEqual({ kind: 'reaeq', bands: [{ type: 'Band', enabled: true, freq: 1000, gain: 0, bw: 1 }] })
  })
})
