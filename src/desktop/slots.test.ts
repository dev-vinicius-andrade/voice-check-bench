import { describe, expect, it } from 'vitest'
import { b64decode, b64encode, db2a, readBank, readEq } from '../wavelink/fxp'
import { bankBlob, gateValues } from '../wavelink/testFixtures'
import { withChange } from './advice/chain'
import type { ValueChange } from './advice/types'
import { changeLineMsg } from './changeMsg'
import { exportPlan } from './exportPlan'
import { chainOf, DB_FLOOR, encodeEqState, engineOp, eqStateValues, PARAM_MAPS, slotKind } from './slots'
import { fromPos, slidersOf, toPos } from './sliderSpecs'
import { engineSlots, entries, eqBytes as eqBytesOf, GATE, NR } from './testChain'

const f32 = (v: number) => Math.fround(v)
const eqBytes = eqBytesOf()

const change = (slotIndex: number, key: string, from: number, to: number): ValueChange => ({
  id: `t:${slotIndex}:${key}`,
  reason: 'tone',
  titleMsg: { key: 'x' },
  kind: 'value',
  slot: slotIndex,
  key,
  from,
  to,
})

describe('engine slots → chain in real units', () => {
  it('names each kind', () => {
    expect(chainOf(engineSlots(), entries()).map((s) => s.kind)).toEqual(['noiseRemoval', 'reagate', 'reaeq', 'reacomp', 'builtin', 'reafir'])
    expect(slotKind('Elgato De-Esser', 'hosted')).toBe('deesser')
    expect(slotKind('Something', 'loadFailed')).toBe('other')
  })

  it('decodes ReaGate, ReaComp, Noise Removal from the engine and ReaEQ from the stored state', () => {
    const [nr, gate, eq, comp, builtin, fir] = chainOf(engineSlots(), entries())
    expect(nr.values.strength).toBeCloseTo(85, 5)
    expect(gate.values.thresholdDb).toBeCloseTo(-40, 4)
    expect(gate.values.holdMs).toBeCloseTo(100, 3)
    expect(gate.values.releaseMs).toBeCloseTo(300, 2)
    expect(gate.values.wetDb).toBeCloseTo(0, 5)
    expect(gate.values.dryDb).toBe(DB_FLOOR) // amplitude 0 = off
    expect(comp.values).toMatchObject({ ratio: expect.closeTo(4, 4), attackMs: expect.closeTo(3, 3), releaseMs: expect.closeTo(80, 2) })
    expect(comp.values.thresholdDb).toBeCloseTo(-20, 4)
    expect(eq.values['band2.freqHz']).toBe(3500)
    expect(eq.values['band2.gainDb']).toBeCloseTo(-2, 9)
    expect(eq.values['band1.type']).toBe(0)
    expect(builtin.values).toEqual({})
    expect(fir.on).toBe(false)
  })

  it('reading an unreadable ReaEQ state gives no values', () => {
    expect(eqStateValues('AAAA')).toEqual({})
  })
})

describe('chain values → engine commands', () => {
  it('ReaGate/ReaComp values go out as the bank floats the decoding reads back', () => {
    const chain = chainOf(engineSlots(), entries())
    const cases: [number, string, number, number][] = [
      [1, 'thresholdDb', -52, db2a(-52)],
      [1, 'holdMs', 150, 0.15],
      [1, 'releaseMs', 200, 0.04],
      [1, 'dryDb', -20, db2a(-20)],
      [1, 'wetDb', DB_FLOOR, 0],
      [3, 'ratio', 3, 2 / 99],
      [3, 'attackMs', 5, 0.01],
      [3, 'wetDb', 6, db2a(6)],
    ]
    for (const [i, key, to, norm] of cases) {
      const c = change(i, key, chain[i].values[key], to)
      const op = engineOp(c, withChange(chain, c), engineSlots(), entries())
      expect(op).toEqual({ op: 'param', slot: i, id: PARAM_MAPS[chain[i].kind]![key].id, value: expect.closeTo(norm, 9) })
      // and back: the engine float decodes to the value in units
      const back = PARAM_MAPS[chain[i].kind]![key].toUnits(f32(norm))
      expect(back).toBeCloseTo(to, 3)
    }
  })

  it('Noise Removal strength 0..100 is VAD Threshold 0..1', () => {
    const chain = chainOf(engineSlots(), entries())
    const c = change(0, 'strength', 85, 65)
    expect(engineOp(c, withChange(chain, c), engineSlots(), entries())).toEqual({ op: 'param', slot: 0, id: 1163972580, value: 0.65 })
  })

  it('ReaEQ changes load a re-encoded state that keeps every other byte', () => {
    const chain = chainOf(engineSlots(), entries())
    const c = change(2, 'band2.gainDb', -2, -4.5)
    const op = engineOp(c, withChange(chain, c), engineSlots(), entries())
    expect(op?.op).toBe('state')
    const state = op && op.op === 'state' ? op.parameterState : ''
    const after = readEq(b64decode(state))
    expect(after.bands[1].gain).toBeCloseTo(db2a(-4.5), 12)
    expect(after.bands[0]).toEqual(readEq(eqBytes).bands[0])
    expect(eqStateValues(state)['band2.gainDb']).toBeCloseTo(-4.5, 9)
    // unchanged values re-encode byte-identically
    expect(encodeEqState(b64encode(eqBytes), chain[2].values)).toBe(b64encode(eqBytes))
  })

  it('a switch is a bypass', () => {
    const chain = chainOf(engineSlots(), entries())
    const c = { id: 's', reason: 'undo' as const, titleMsg: { key: 'x' }, kind: 'switch' as const, slot: 5, on: true }
    expect(engineOp(c, chain, engineSlots(), entries())).toEqual({ op: 'bypass', slot: 5, bypassed: false })
  })
})

describe('export plan', () => {
  it('writes only what changed: ReaGate floats, ReaEQ fields, VST2 on/off; Elgato changes are listed as unsaved', () => {
    const start = chainOf(engineSlots(), entries())
    const slots = engineSlots()
    // the engine took ReaGate Dry −20 dB
    slots[1] = { ...slots[1], params: slots[1].params.map((p) => (p.id === 9 ? { ...p, normalized: f32(db2a(-20)) } : p)) }
    let chain = withChange(start, change(1, 'dryDb', DB_FLOOR, -20))
    chain = withChange(chain, change(2, 'band3.gainDb', 1.5, 0))
    chain = withChange(chain, change(0, 'strength', 85, 65))
    chain = withChange(chain, { id: 's', reason: 'undo', titleMsg: { key: 'x' }, kind: 'switch', slot: 5, on: true })
    const plan = exportPlan('PCM_IN', start, chain, slots, entries())
    expect(plan.unsaved).toEqual([0])
    expect(plan.changes.map((c) => [c.index, c.parameterState !== undefined, c.bypassed])).toEqual([
      [1, true, undefined],
      [2, true, undefined],
      [5, false, false],
    ])
    const gate = readBank(b64decode(plan.changes[0].parameterState!))
    expect(gate.vals[9]).toBe(f32(db2a(-20)))
    expect(gate.vals.filter((_, k) => k !== 9)).toEqual(readBank(bankBlob(gateValues())).vals.filter((_, k) => k !== 9))
    expect(readEq(b64decode(plan.changes[1].parameterState!)).bands[2].gain).toBe(1)
  })

  it('Elgato changes are written from the engine export: its state and the matching BypassState', () => {
    const start = chainOf(engineSlots(), entries())
    let chain = withChange(start, change(0, 'strength', 85, 65))
    chain = withChange(chain, { id: 's', reason: 'undo', titleMsg: { key: 'x' }, kind: 'switch', slot: 0, on: false })
    const exported = [
      { index: 0, name: NR, filePath: '', bypassed: true, parameterState: 'TlIy' },
      { index: 1, name: GATE, filePath: '', bypassed: false, parameterState: entries()[1].parameterState },
    ]
    const plan = exportPlan('PCM_IN', start, chain, engineSlots(), entries(), exported)
    expect(plan).toEqual({ changes: [{ inputKey: 'PCM_IN', index: 0, parameterState: 'TlIy', bypassed: true }], unsaved: [] })
    // not changed live: whatever the engine exports, nothing is written
    expect(exportPlan('PCM_IN', start, start, engineSlots(), entries(), exported).changes).toEqual([])
  })

  it('nothing changed → nothing to write', () => {
    const start = chainOf(engineSlots(), entries())
    expect(exportPlan('PCM_IN', start, start, engineSlots(), entries())).toEqual({ changes: [], unsaved: [] })
  })
})

describe('sliders and change lines', () => {
  it('sliders exist only for values present; log sliders round-trip', () => {
    const [nr, gate, eq, comp, builtin] = chainOf(engineSlots(), entries())
    expect(slidersOf(gate).map((s) => s.key)).toEqual(['thresholdDb', 'holdMs', 'releaseMs', 'wetDb', 'dryDb'])
    expect(slidersOf(comp).map((s) => s.key)).toContain('ratio')
    expect(slidersOf(nr).map((s) => s.key)).toEqual(['strength'])
    expect(slidersOf(eq)).toHaveLength(6)
    expect(slidersOf(builtin)).toEqual([])
    const freq = slidersOf(eq)[1]
    expect(fromPos(freq, toPos(freq, 3500))).toBe(3500)
  })

  it('change lines name the plugin and field', () => {
    const [, gate, eq] = chainOf(engineSlots(), entries())
    expect(changeLineMsg(gate, change(1, 'dryDb', 0, -20))).toEqual({ key: 'desktop.advice.change.db', params: { plugin: 'ReaGate', field: 'Dry', from: 0, to: -20 } })
    expect(changeLineMsg(gate, change(1, 'holdMs', 100, 150)).key).toBe('desktop.advice.change.ms')
    expect(changeLineMsg(eq, change(2, 'band2.gainDb', -2, -4)).params).toMatchObject({ type: 'Band', freq: 3500 })
    expect(changeLineMsg(eq, change(2, 'band2.freqHz', 3500, 4000)).key).toBe('desktop.advice.change.hz')
  })
})
