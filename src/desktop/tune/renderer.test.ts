import { describe, expect, it } from 'vitest'
import { b64decode, readBank } from '../../wavelink/fxp'
import type { SwitchChange, ValueChange } from '../advice/types'
import { chainOf, eqStateValues, PARAM_MAPS } from '../slots'
import { engineSlots, entries, INPUT_KEY, snapshot } from '../testChain'
import type { AudioExportedState, AudioSlot, WlSnapshot } from '../types'
import { openTuneSession, type TuneBridge } from './renderer'

const VAD_ID = 1163972580
function wetMap() {
  const m = PARAM_MAPS.reacomp?.wetDb
  if (!m) throw new Error('no ReaComp Wet map')
  return m
}
const WET = wetMap()

const change = (slot: number, key: string, to: number): ValueChange => ({ id: `t:${slot}:${key}`, reason: 'tone', titleMsg: { key: 'x' }, kind: 'value', slot, key, from: NaN, to })

const flip = (slot: number, on: boolean): SwitchChange => ({ id: `t:${slot}:on`, reason: 'tone', titleMsg: { key: 'x' }, kind: 'switch', slot, on })

/** A render session over the test chain: records every command, renders the take × a gain read from ReaComp Wet. */
function fakeBridge(snap: WlSnapshot = snapshot()) {
  const calls: string[] = []
  let slots: AudioSlot[] = engineSlots()
  const states = new Map<number, string>(entries().map((e) => [e.index, e.parameterState]))
  const reply = (index: number): AudioSlot => slots.find((s) => s.index === index) as AudioSlot
  const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 1))
  const bridge: TuneBridge = {
    renderOpen: async () => ({ sampleRate: 48000, latencySamples: 480, slots: engineSlots() }),
    wavelinkRead: async () => snap,
    renderSetParam: async (slot, id, value) => {
      await tick()
      calls.push(`param ${slot} ${id} ${value}`)
      slots = slots.map((s) => (s.index === slot ? { ...s, params: s.params.map((p) => (p.id === id ? { ...p, normalized: Math.fround(value) } : p)) } : s))
      if (slot === 0) states.set(0, `nr:${value}`)
      return reply(slot)
    },
    renderSetBypass: async (slot, bypassed) => {
      calls.push(`bypass ${slot} ${bypassed}`)
      return reply(slot)
    },
    renderLoadState: async (slot, state) => {
      await tick()
      calls.push(`state ${slot}`)
      states.set(slot, state)
      return reply(slot)
    },
    renderRun: async (x) => {
      await tick()
      calls.push('run')
      const wet = reply(3).params.find((p) => p.id === WET.id)?.normalized ?? 1
      return x.map((v) => v * wet)
    },
    renderExportStates: async (): Promise<AudioExportedState[]> =>
      slots.filter((s) => s.status.status === 'hosted').map((s) => ({ index: s.index, name: s.name, filePath: s.filePath, bypassed: s.bypassed, parameterState: states.get(s.index) ?? '' })),
    renderClose: async () => {
      calls.push('close')
    },
  }
  return { bridge, calls, states }
}

const take = Float32Array.from([0.1, -0.2, 0.3])

describe('openTuneSession', () => {
  it('opens the render session and reads the chain in real units from it and the Wave Link entries', async () => {
    const { bridge, calls } = fakeBridge()
    const s = await openTuneSession(bridge, take)
    expect(s.chain).toEqual(chainOf(engineSlots(), entries()))
    expect(calls).toEqual([])
    const out = await s.render([])
    expect(calls).toEqual(['run'])
    expect(out.length).toBe(take.length)
  })

  it('a ReaComp Wet change goes out as its bank float, and back to the stored float exactly when it is not listed', async () => {
    const { bridge, calls } = fakeBridge()
    const s = await openTuneSession(bridge, take)
    const stored = engineSlots()[3].params.find((p) => p.id === WET.id)?.normalized
    await s.render([change(3, 'wetDb', 12)])
    expect(calls).toEqual([`param 3 ${WET.id} ${WET.fromUnits(12)}`, 'run'])
    await s.render([])
    expect(calls.slice(2)).toEqual([`param 3 ${WET.id} ${stored}`, 'run'])
    await s.render([])
    expect(calls.slice(4)).toEqual(['run'])
  })

  it('several ReaEQ band moves are one state load; going back loads the stored state byte for byte', async () => {
    const { bridge, calls, states } = fakeBridge()
    const s = await openTuneSession(bridge, take)
    await s.render([change(2, 'band1.gainDb', -2), change(2, 'band3.gainDb', 3)])
    expect(calls).toEqual(['state 2', 'run'])
    const v = eqStateValues(states.get(2) ?? '')
    expect(v['band1.gainDb']).toBeCloseTo(-2, 9)
    expect(v['band3.gainDb']).toBeCloseTo(3, 9)
    expect(v['band2.gainDb']).toBeCloseTo(-2, 9)
    await s.render([change(2, 'band3.gainDb', 3)])
    expect(calls.slice(2)).toEqual(['state 2', 'run'])
    expect(eqStateValues(states.get(2) ?? '')['band1.gainDb']).toBeCloseTo(0, 9)
    await s.render([])
    expect(states.get(2)).toBe(entries()[2].parameterState)
  })

  it('Noise Removal strength is its VAD Threshold; only what differs from the last render is sent', async () => {
    const { bridge, calls } = fakeBridge()
    const s = await openTuneSession(bridge, take)
    await s.render([change(0, 'strength', 60), change(3, 'wetDb', 12)])
    expect(calls).toEqual([`param 0 ${VAD_ID} 0.6`, `param 3 ${WET.id} ${WET.fromUnits(12)}`, 'run'])
    await s.render([change(0, 'strength', 60)])
    expect(calls.slice(3)).toEqual([expect.stringMatching(new RegExp(`^param 3 ${WET.id} `)), 'run'])
  })

  it('a later change of the same value wins', async () => {
    const { bridge, calls } = fakeBridge()
    const s = await openTuneSession(bridge, take)
    await s.render([change(3, 'wetDb', 12), change(3, 'wetDb', 9)])
    expect(calls).toEqual([`param 3 ${WET.id} ${WET.fromUnits(9)}`, 'run'])
  })

  it('a value the adapter cannot set rejects the render instead of rendering something else', async () => {
    const { bridge, calls } = fakeBridge()
    const s = await openTuneSession(bridge, take)
    await expect(s.render([change(3, 'nope', 1)])).rejects.toThrow(/nope/)
    expect(calls).toEqual([])
    await s.render([])
    expect(calls).toEqual(['run'])
  })

  it('renders one at a time, in call order', async () => {
    const { bridge, calls } = fakeBridge()
    const s = await openTuneSession(bridge, take)
    const [a, b] = await Promise.all([s.render([change(3, 'wetDb', 12)]), s.render([change(0, 'strength', 50)])])
    // commands go in chain order: Noise Removal (slot 0) before ReaComp (slot 3)
    expect(calls).toEqual([`param 3 ${WET.id} ${WET.fromUnits(12)}`, 'run', `param 0 ${VAD_ID} 0.5`, expect.stringMatching(/^param 3 /), 'run'])
    expect(a[0]).toBeCloseTo(0.1 * Math.fround(WET.fromUnits(12)), 6)
    expect(b.length).toBe(take.length)
  })

  it('exportChanges: the changed ReaComp float in its stored bank, the Elgato state as the session exports it', async () => {
    const { bridge } = fakeBridge()
    const s = await openTuneSession(bridge, take)
    await s.render([change(2, 'band1.gainDb', -3)])
    const out = await s.exportChanges([change(3, 'wetDb', 12), change(0, 'strength', 60)])
    expect(out.map((c) => c.index)).toEqual([0, 3])
    expect(out.every((c) => c.inputKey === INPUT_KEY && c.bypassed === undefined)).toBe(true)
    expect(out[0].parameterState).toBe('nr:0.6')
    const bank = readBank(b64decode(out[1].parameterState ?? ''))
    expect(bank.vals[WET.id]).toBe(Math.fround(WET.fromUnits(12)))
    expect(await s.exportChanges([])).toEqual([])
  })

  it('a plugin on its own bypass (stored Noise Removal state) is off for the tuner, and Save does not write it', async () => {
    const { bridge, calls } = fakeBridge()
    const open = bridge.renderOpen
    bridge.renderOpen = async () => {
      const st = await open()
      return { ...st, slots: st.slots.map((x) => (x.index === 0 ? { ...x, params: x.params.map((p) => (p.isBypass ? { ...p, normalized: 1 } : p)) } : x)) }
    }
    const s = await openTuneSession(bridge, take)
    expect(s.chain[0]).toMatchObject({ kind: 'noiseRemoval', on: false })
    expect(s.chain.slice(1)).toEqual(chainOf(engineSlots(), entries()).slice(1))
    expect(await s.exportChanges([])).toEqual([])
    const out = await s.exportChanges([change(3, 'wetDb', 12)])
    expect(out.map((c) => c.index)).toEqual([3])
    expect(calls.filter((c) => c.startsWith('bypass'))).toEqual([])
  })

  it('rejects and closes the render session when Settings.json does not describe its chain', async () => {
    const snap = snapshot()
    const other: WlSnapshot = { ...snap, inputs: [{ ...snap.inputs[0], entries: snap.inputs[0].entries.slice(1) }] }
    const { bridge, calls } = fakeBridge(other)
    await expect(openTuneSession(bridge, take)).rejects.toThrow(/Settings\.json/)
    expect(calls).toEqual(['close'])
  })

  it('picks the input whose entries match the slots, closes the session on close()', async () => {
    const snap = snapshot()
    const twin: WlSnapshot = { ...snap, inputs: [{ key: 'other', label: 'Other', entries: [] }, ...snap.inputs] }
    const { bridge, calls } = fakeBridge(twin)
    const s = await openTuneSession(bridge, take)
    const out = await s.exportChanges([change(3, 'wetDb', 12)])
    expect(out[0].inputKey).toBe(INPUT_KEY)
    await s.close()
    expect(calls.at(-1)).toBe('close')
  })

  it('a slot switched off is bypassed for that render and back on for the next; Save writes its BypassState', async () => {
    const { bridge, calls } = fakeBridge()
    const s = await openTuneSession(bridge, take)
    await s.render([flip(1, false), change(3, 'wetDb', 12)])
    expect(calls.filter((c) => c.startsWith('bypass'))).toEqual(['bypass 1 true'])
    // the bypass goes out before the run it is for
    expect(calls.indexOf('bypass 1 true')).toBeLessThan(calls.indexOf('run'))
    await s.render([flip(1, false)])
    expect(calls.filter((c) => c.startsWith('bypass'))).toEqual(['bypass 1 true'])
    await s.render([])
    expect(calls.filter((c) => c.startsWith('bypass'))).toEqual(['bypass 1 true', 'bypass 1 false'])
    const out = await s.exportChanges([flip(1, false)])
    expect(out).toEqual([{ inputKey: INPUT_KEY, index: 1, bypassed: true }])
    expect(await s.exportChanges([])).toEqual([])
  })

  it('a Noise Removal on its own bypass switched on: taken off that bypass, its strength set, and Save writes the state that carries both', async () => {
    const { bridge, calls } = fakeBridge()
    const open = bridge.renderOpen
    bridge.renderOpen = async () => {
      const st = await open()
      return { ...st, slots: st.slots.map((x) => (x.index === 0 ? { ...x, params: x.params.map((p) => (p.isBypass ? { ...p, normalized: 1 } : p)) } : x)) }
    }
    // the plugin's state carries its own bypass, as the real one's does
    let own: boolean | null = null
    const setBypass = bridge.renderSetBypass
    bridge.renderSetBypass = async (slot, bypassed) => {
      if (slot === 0) own = bypassed
      return setBypass(slot, bypassed)
    }
    const exportStates = bridge.renderExportStates
    bridge.renderExportStates = async () => (await exportStates()).map((e) => (e.index === 0 && own !== null ? { ...e, parameterState: `${e.parameterState}|bypass:${own}` } : e))
    const s = await openTuneSession(bridge, take)
    expect(s.chain[0]).toMatchObject({ kind: 'noiseRemoval', on: false })
    await s.render([flip(0, true), change(0, 'strength', 20)])
    expect(calls.slice(0, 3)).toEqual(['bypass 0 false', `param 0 ${VAD_ID} 0.2`, 'run'])
    // the switch alone is a change too: Wave Link already lists the plugin as on, the state is what differs
    const out = await s.exportChanges([flip(0, true)])
    expect(out.map((c) => c.index)).toEqual([0])
    expect(out[0].parameterState).toContain('bypass:false')
    expect(out[0].bypassed).toBeUndefined()
    // switched back for a result without it: off again, and nothing of it is written
    expect(await s.exportChanges([change(3, 'wetDb', 12)])).toMatchObject([{ index: 3 }])
    expect(calls.filter((c) => c.startsWith('bypass')).at(-1)).toBe('bypass 0 true')
  })

  it('the frequency, width and gain of a band travel as one ReaEQ state (a result change with `also`)', async () => {
    const { bridge, calls, states } = fakeBridge()
    const s = await openTuneSession(bridge, take)
    const band = { ...change(2, 'band2.gainDb', -4), also: [change(2, 'band2.freqHz', 220), change(2, 'band2.bwOct', 1)] }
    await s.render([band])
    expect(calls).toEqual(['state 2', 'run'])
    expect(eqStateValues(states.get(2) ?? '')).toMatchObject({ 'band2.gainDb': expect.closeTo(-4, 4), 'band2.freqHz': 220, 'band2.bwOct': 1 })
    const out = await s.exportChanges([band])
    expect(out.map((c) => c.index)).toEqual([2])
    expect(eqStateValues(out[0].parameterState ?? '')).toMatchObject({ 'band2.freqHz': 220, 'band2.bwOct': 1 })
  })
})

describe('TuneSession.setState', () => {
  const FIR = 5
  /** The fake session re-saves a loaded state its own way, as the real plugin re-encodes its profile. */
  function resaving() {
    const f = fakeBridge()
    const exportStates = f.bridge.renderExportStates
    f.bridge.renderExportStates = async () => (await exportStates()).map((e) => (e.index === FIR ? { ...e, parameterState: `${e.parameterState}|saved` } : e))
    return f
  }

  it('loads the state for every later render, serialized with them; the chain model does not change', async () => {
    const { bridge, calls, states } = resaving()
    const s = await openTuneSession(bridge, take)
    const chain = structuredClone(s.chain)
    await Promise.all([s.render([]), s.setState(FIR, 'subtract'), s.render([change(3, 'wetDb', 12)])])
    expect(calls).toEqual(['run', `state ${FIR}`, `param 3 ${WET.id} ${WET.fromUnits(12)}`, 'run'])
    expect(states.get(FIR)).toBe('subtract')
    expect(s.chain).toEqual(chain)
    await s.render([])
    // the ReaComp value goes back; the loaded state stays
    expect(calls.slice(4)).toEqual([`param 3 ${WET.id} ${engineSlots()[3].params.find((p) => p.id === WET.id)?.normalized}`, 'run'])
    expect(states.get(FIR)).toBe('subtract')
  })

  it('exportChanges writes a loaded slot as the session exports it, whatever the changes, in slot order', async () => {
    const { bridge } = resaving()
    const s = await openTuneSession(bridge, take)
    expect(await s.exportChanges([])).toEqual([])
    await s.setState(FIR, 'subtract')
    expect(await s.exportChanges([])).toEqual([{ inputKey: INPUT_KEY, index: FIR, parameterState: 'subtract|saved' }])
    const out = await s.exportChanges([change(3, 'wetDb', 12)])
    expect(out.map((c) => c.index)).toEqual([3, FIR])
    expect(out[1]).toEqual({ inputKey: INPUT_KEY, index: FIR, parameterState: 'subtract|saved' })
    // switched on in the same Save (it is off in Wave Link): one change carries both
    expect(await s.exportChanges([flip(FIR, true)])).toEqual([{ inputKey: INPUT_KEY, index: FIR, bypassed: false, parameterState: 'subtract|saved' }])
  })

  it('null loads the stored state back and the slot leaves exportChanges; null without a loaded state sends nothing', async () => {
    const { bridge, calls, states } = resaving()
    const s = await openTuneSession(bridge, take)
    await s.setState(FIR, null)
    expect(calls).toEqual([])
    await s.setState(FIR, 'subtract')
    await s.setState(FIR, 'stronger')
    expect(states.get(FIR)).toBe('stronger')
    await s.setState(FIR, null)
    expect(calls).toEqual([`state ${FIR}`, `state ${FIR}`, `state ${FIR}`])
    expect(states.get(FIR)).toBe(entries()[FIR].parameterState)
    expect(await s.exportChanges([])).toEqual([])
  })

  it('rejects for a slot the session does not host; the session goes on', async () => {
    const { bridge, calls } = fakeBridge()
    const s = await openTuneSession(bridge, take)
    await expect(s.setState(4, 'x')).rejects.toThrow(/not hosted/)
    await expect(s.setState(9, 'x')).rejects.toThrow(/not hosted/)
    await s.render([])
    expect(calls).toEqual(['run'])
  })

  it('exportChanges rejects when the session does not export a loaded slot', async () => {
    const { bridge } = fakeBridge()
    const s = await openTuneSession(bridge, take)
    await s.setState(FIR, 'subtract')
    const exportStates = bridge.renderExportStates
    bridge.renderExportStates = async () => (await exportStates()).filter((e) => e.index !== FIR)
    await expect(s.exportChanges([])).rejects.toThrow(/did not export/)
  })
})
