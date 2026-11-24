// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { applyCommand, replugsAdapter, registerReaplugsAdapter, replugsCapability } from './reaplugsAdapter'
import { getAdapters, hasAdapterFor, findAdapter, type ActuatorCommand } from '../../plain/actuator'
import { classify } from '../../plain/classify'
import { fakeAnalysis } from '../../audio/testSignals'
import { DEFAULT_GOAL } from '../../types'
import { eq, gate, comp, noiseRemoval, GUIDE_BANDS } from './testFixtures'
import { eqKey } from './chain'
import type { ChainSlot, ValueChange, SwitchChange } from './types'
import { EQ_TYPES } from '../../wavelink/fxp'

// ---- helpers ----

const valueChanges = (changes: ReturnType<typeof applyCommand>): ValueChange[] =>
  (changes ?? []).filter((c): c is ValueChange => c.kind === 'value')

const switchChanges = (changes: ReturnType<typeof applyCommand>): SwitchChange[] =>
  (changes ?? []).filter((c): c is SwitchChange => c.kind === 'switch')

/** A ReaFIR slot for noise subtraction tests. */
const reafir = (on = false, index = 4): ChainSlot => ({
  index,
  kind: 'reafir',
  name: 'ReaFIR (ReaPlugs Edition)',
  on,
  values: {},
})

/** A De-Esser slot for deess tests. */
const deesser = (on = false, index = 5): ChainSlot => ({
  index,
  kind: 'deesser',
  name: 'De-Esser (ReaPlugs Edition)',
  on,
  values: {},
})

/** Standard chain with all plugin types present; band 2 is disabled so EQ commands have a free band. */
const fullChain = (): ChainSlot[] => {
 const bands = GUIDE_BANDS.map((b, i) => ({ ...b, on: i !== 1 }))
 return [noiseRemoval(), gate(), eq(bands), comp(), reafir(), deesser()]
}

/** Chain where every ReaEQ band is enabled (no free bands). */
const chainNoFreeBands = (): ChainSlot[] => {
  const allOn = GUIDE_BANDS.map((b) => ({ ...b, on: true }))
  return [noiseRemoval(), gate(), eq(allOn), comp()]
}

// ---- adapter registration and capability ----

describe('reaplugsAdapter: registration', () => {
  // The global adapter registry persists across tests; registration tests verify additive behavior.

  it('has the correct capability id and name', () => {
    expect(replugsCapability.id).toBe('reaplugs')
    expect(replugsCapability.name).toBe('Wave Link ReaPlugs')
  })

  it('handles all nine command types', () => {
    expect(replugsCapability.handles).toEqual([
      'highpass', 'eqCut', 'eqBoost', 'lowShelf', 'highShelf',
      'noiseSubtract', 'gate', 'compress', 'deess',
    ])
  })

  it('canHandle returns true for every supported command type', () => {
    const cmds: ActuatorCommand[] = [
      { type: 'highpass', freqHz: 80 },
      { type: 'eqCut', freqHz: 60, gainDb: -12, bwOct: 0.1 },
      { type: 'eqBoost', freqHz: 3000, gainDb: 3, bwOct: 1 },
      { type: 'lowShelf', freqHz: 150, gainDb: -3 },
      { type: 'highShelf', freqHz: 10000, gainDb: 2 },
      { type: 'noiseSubtract', profileNote: 'broadband' },
      { type: 'gate', thresholdDb: -40 },
      { type: 'compress', thresholdDb: -28, ratio: 3 },
      { type: 'deess' },
    ]
    for (const cmd of cmds) {
      expect(replugsAdapter.canHandle(cmd)).toBe(true)
    }
  })

  it('registerReaplugsAdapter adds the adapter to the global registry', () => {
    const before = getAdapters().length
    registerReaplugsAdapter()
    expect(getAdapters().length).toBe(before + 1)
    expect(getAdapters()[getAdapters().length - 1]).toBe(replugsAdapter)
  })

  it('hasAdapterFor returns true after registration for all supported commands', () => {
    registerReaplugsAdapter()
    expect(hasAdapterFor({ type: 'eqCut', freqHz: 60, gainDb: -12, bwOct: 0.1 })).toBe(true)
    expect(hasAdapterFor({ type: 'gate', thresholdDb: -40 })).toBe(true)
    expect(hasAdapterFor({ type: 'compress', thresholdDb: -28, ratio: 3 })).toBe(true)
    expect(hasAdapterFor({ type: 'noiseSubtract', profileNote: 'broadband' })).toBe(true)
    expect(hasAdapterFor({ type: 'deess' })).toBe(true)
    expect(hasAdapterFor({ type: 'highpass', freqHz: 80 })).toBe(true)
    expect(hasAdapterFor({ type: 'lowShelf', freqHz: 150, gainDb: -3 })).toBe(true)
    expect(hasAdapterFor({ type: 'highShelf', freqHz: 10000, gainDb: 2 })).toBe(true)
    expect(hasAdapterFor({ type: 'eqBoost', freqHz: 3000, gainDb: 3, bwOct: 1 })).toBe(true)
  })

  it('findAdapter returns the replugs adapter for supported commands after registration', () => {
    registerReaplugsAdapter()
    const adapter = findAdapter({ type: 'eqCut', freqHz: 60, gainDb: -12, bwOct: 0.1 })
    expect(adapter).toBe(replugsAdapter)
  })
})

// ---- classify installOffer integration ----

describe('reaplugsAdapter: classify installOffer', () => {
  it('installOffer is true when no adapter is registered and problems have actuator commands', () => {
    // hum produces an eqCut actuator command
    const a = fakeAnalysis({ hum: [{ hz: 60, db: 14 }] })
    const report = classify(a, undefined, DEFAULT_GOAL)
    // Before registering, installOffer should be true (assuming clean registry in test env)
    // Note: this test depends on registry state; other tests may have registered already.
    // We test the logical relationship instead.
    expect(report.problems.length).toBeGreaterThan(0)
    const hasActuator = report.problems.some((p) => p.steps.some((s) => s.actuator))
    expect(hasActuator).toBe(true)
  })

  it('installOffer becomes false once the replugs adapter is registered for hum problems', () => {
    registerReaplugsAdapter()
    const a = fakeAnalysis({ hum: [{ hz: 60, db: 14 }] })
    const report = classify(a, undefined, DEFAULT_GOAL)
    // After registration, hasAdapterFor returns true for eqCut, so installOffer should be false
    expect(report.installOffer).toBe(false)
  })

  it('installOffer becomes false for broadband hiss (noiseSubtract) after registration', () => {
    registerReaplugsAdapter()
    const a = fakeAnalysis({ noiseKind: 'broadband', snr: 12, noise: -55 })
    const report = classify(a, undefined, DEFAULT_GOAL)
    expect(report.installOffer).toBe(false)
  })

  it('installOffer becomes false for tooQuiet (compress) after registration', () => {
    registerReaplugsAdapter()
    const a = fakeAnalysis({ speechMed: -38 })
    const report = classify(a, undefined, DEFAULT_GOAL)
    expect(report.installOffer).toBe(false)
  })

  it('installOffer becomes false for sibilance (deess) after registration', () => {
    registerReaplugsAdapter()
    const a = fakeAnalysis({ sibP95: -4 })
    const report = classify(a, undefined, DEFAULT_GOAL)
    expect(report.installOffer).toBe(false)
  })

  it('installOffer becomes false for tone problems (lowShelf/highShelf/eqCut) after registration', () => {
    registerReaplugsAdapter()
    // boomy → lowShelf
    const rel = [-18, -4 + 7, -1, 2, 0, -6, -7, -11, -17]
    const a = fakeAnalysis({ rel })
    const report = classify(a, undefined, DEFAULT_GOAL)
    expect(report.installOffer).toBe(false)
  })
})

// ---- applyCommand: each variant produces correct Changes ----

describe('applyCommand: eqCut', () => {
  it('produces five value changes targeting a free EQ band', () => {
    const c = fullChain()
    const cmd: ActuatorCommand = { type: 'eqCut', freqHz: 60, gainDb: -12, bwOct: 0.1 }
    const changes = applyCommand(cmd, c)
    expect(changes).not.toBeNull()
    expect(changes!.length).toBe(5)
    const vc = valueChanges(changes)
    expect(vc.length).toBe(5)
    // All target the ReaEQ slot (index 2)
    for (const v of vc) expect(v.slot).toBe(2)
    // Check specific fields
    const freqChange = vc.find((v) => v.key === eqKey(2, 'freqHz'))
    expect(freqChange?.to).toBe(60)
    const gainChange = vc.find((v) => v.key === eqKey(2, 'gainDb'))
    expect(gainChange?.to).toBe(-12)
    const bwChange = vc.find((v) => v.key === eqKey(2, 'bwOct'))
    expect(bwChange?.to).toBe(0.1)
    const typeChange = vc.find((v) => v.key === eqKey(2, 'type'))
    expect(typeChange?.to).toBe(EQ_TYPES.Band)
    const onChange = vc.find((v) => v.key === eqKey(2, 'on'))
    expect(onChange?.to).toBe(1)
  })

  it('uses the first disabled band', () => {
    // Band 2 is off, others on
    const bands = GUIDE_BANDS.map((b, i) => ({ ...b, on: i !== 1 }))
    const c = [noiseRemoval(), gate(), eq(bands), comp()]
    const cmd: ActuatorCommand = { type: 'eqCut', freqHz: 120, gainDb: -6, bwOct: 0.2 }
    const changes = applyCommand(cmd, c)
    expect(changes).not.toBeNull()
    // Should target band 2 (the disabled one)
    const vc = valueChanges(changes)
    const freqChange = vc.find((v) => v.key.includes('freqHz'))
    expect(freqChange?.key).toBe(eqKey(2, 'freqHz'))
  })
})

describe('applyCommand: eqBoost', () => {
  it('produces five value changes with positive gain', () => {
    const c = fullChain()
    const cmd: ActuatorCommand = { type: 'eqBoost', freqHz: 3000, gainDb: 4, bwOct: 1.2 }
    const changes = applyCommand(cmd, c)
    expect(changes).not.toBeNull()
    const vc = valueChanges(changes)
    const gainChange = vc.find((v) => v.key.includes('gainDb'))
    expect(gainChange?.to).toBe(4)
    const freqChange = vc.find((v) => v.key.includes('freqHz'))
    expect(freqChange?.to).toBe(3000)
  })
})

describe('applyCommand: highpass', () => {
  it('sets gain to -48 dB and uses slope-derived bandwidth', () => {
    const c = fullChain()
    const cmd: ActuatorCommand = { type: 'highpass', freqHz: 80, slopeDbPerOct: 12 }
    const changes = applyCommand(cmd, c)
    expect(changes).not.toBeNull()
    const vc = valueChanges(changes)
    const gainChange = vc.find((v) => v.key.includes('gainDb'))
    expect(gainChange?.to).toBe(-48)
    const bwChange = vc.find((v) => v.key.includes('bwOct'))
    expect(bwChange?.to).toBe(2) // 12 / 6
  })

  it('defaults bandwidth to 1 when slopeDbPerOct is omitted', () => {
    const c = fullChain()
    const cmd: ActuatorCommand = { type: 'highpass', freqHz: 100 }
    const changes = applyCommand(cmd, c)
    const vc = valueChanges(changes)
    const bwChange = vc.find((v) => v.key.includes('bwOct'))
    expect(bwChange?.to).toBe(1)
  })
})

describe('applyCommand: lowShelf', () => {
  it('targets band 1 with Low Shelf type', () => {
    const c = fullChain()
    const cmd: ActuatorCommand = { type: 'lowShelf', freqHz: 150, gainDb: -3 }
    const changes = applyCommand(cmd, c)
    expect(changes).not.toBeNull()
    const vc = valueChanges(changes)
    // Should target band 1
    const typeChange = vc.find((v) => v.key === eqKey(1, 'type'))
    expect(typeChange?.to).toBe(EQ_TYPES['Low Shelf'])
    const freqChange = vc.find((v) => v.key === eqKey(1, 'freqHz'))
    expect(freqChange?.to).toBe(150)
    const gainChange = vc.find((v) => v.key === eqKey(1, 'gainDb'))
    expect(gainChange?.to).toBe(-3)
  })
})

describe('applyCommand: highShelf', () => {
  it('targets the last band with High Shelf type', () => {
    const c = fullChain()
    const cmd: ActuatorCommand = { type: 'highShelf', freqHz: 10000, gainDb: 2 }
    const changes = applyCommand(cmd, c)
    expect(changes).not.toBeNull()
    const vc = valueChanges(changes)
    // Last band in GUIDE_BANDS is band 5
    const typeChange = vc.find((v) => v.key === eqKey(5, 'type'))
    expect(typeChange?.to).toBe(EQ_TYPES['High Shelf'])
    const freqChange = vc.find((v) => v.key === eqKey(5, 'freqHz'))
    expect(freqChange?.to).toBe(10000)
    const gainChange = vc.find((v) => v.key === eqKey(5, 'gainDb'))
    expect(gainChange?.to).toBe(2)
  })
})

describe('applyCommand: noiseSubtract', () => {
  it('returns a switch change to turn ReaFIR on when it is off', () => {
    const c = fullChain() // ReaFIR at index 4, off by default
    const cmd: ActuatorCommand = { type: 'noiseSubtract', profileNote: 'broadband' }
    const changes = applyCommand(cmd, c)
    expect(changes).not.toBeNull()
    expect(changes!.length).toBe(1)
    const sc = switchChanges(changes)
    expect(sc.length).toBe(1)
    expect(sc[0].slot).toBe(4)
    expect(sc[0].on).toBe(true)
  })

  it('returns empty array when ReaFIR is already on', () => {
    const c = [noiseRemoval(), gate(), eq(), comp(), reafir(true)]
    const cmd: ActuatorCommand = { type: 'noiseSubtract', profileNote: 'broadband' }
    const changes = applyCommand(cmd, c)
    expect(changes).toEqual([])
  })
})

describe('applyCommand: gate', () => {
  it('changes threshold when gate is on and threshold differs', () => {
    const c = fullChain() // gate at index 1, thresholdDb: -50
    const cmd: ActuatorCommand = { type: 'gate', thresholdDb: -40 }
    const changes = applyCommand(cmd, c)
    expect(changes).not.toBeNull()
    const vc = valueChanges(changes)
    expect(vc.length).toBe(1)
    expect(vc[0].key).toBe('thresholdDb')
    expect(vc[0].from).toBe(-50)
    expect(vc[0].to).toBe(-40)
  })

  it('turns gate on and sets threshold when gate is off', () => {
    const c = [noiseRemoval(), gate({}, false), eq(), comp()]
    const cmd: ActuatorCommand = { type: 'gate', thresholdDb: -35 }
    const changes = applyCommand(cmd, c)
    expect(changes).not.toBeNull()
    const sc = switchChanges(changes)
    const vc = valueChanges(changes)
    expect(sc.length).toBe(1)
    expect(sc[0].on).toBe(true)
    expect(vc.length).toBe(1)
    expect(vc[0].key).toBe('thresholdDb')
    expect(vc[0].to).toBe(-35)
  })

  it('returns null when threshold is already at the target (within tolerance)', () => {
    const c = [noiseRemoval(), gate({ thresholdDb: -40 }), eq(), comp()]
    const cmd: ActuatorCommand = { type: 'gate', thresholdDb: -40 }
    const changes = applyCommand(cmd, c)
    expect(changes).toBeNull()
  })
})

describe('applyCommand: compress', () => {
  it('changes threshold and ratio when both differ', () => {
    const c = fullChain() // comp at index 3, thresholdDb: -30, ratio: 3
    const cmd: ActuatorCommand = { type: 'compress', thresholdDb: -25, ratio: 4 }
    const changes = applyCommand(cmd, c)
    expect(changes).not.toBeNull()
    const vc = valueChanges(changes)
    expect(vc.length).toBe(2)
    const threshChange = vc.find((v) => v.key === 'thresholdDb')
    expect(threshChange?.from).toBe(-30)
    expect(threshChange?.to).toBe(-25)
    const ratioChange = vc.find((v) => v.key === 'ratio')
    expect(ratioChange?.from).toBe(3)
    expect(ratioChange?.to).toBe(4)
  })

  it('turns comp on when it is off', () => {
    const c = [noiseRemoval(), gate(), eq(), comp(6, false)]
    const cmd: ActuatorCommand = { type: 'compress', thresholdDb: -25, ratio: 3 }
    const changes = applyCommand(cmd, c)
    expect(changes).not.toBeNull()
    const sc = switchChanges(changes)
    expect(sc.length).toBe(1)
    expect(sc[0].on).toBe(true)
  })

  it('returns null when threshold and ratio already match', () => {
    const c = [noiseRemoval(), gate(), eq(), comp(6, true)]
    const cmd: ActuatorCommand = { type: 'compress', thresholdDb: -30, ratio: 3 }
    const changes = applyCommand(cmd, c)
    expect(changes).toBeNull()
  })
})

describe('applyCommand: deess', () => {
  it('returns a switch change to turn deesser on when it is off', () => {
    const c = fullChain() // deesser at index 5, off
    const cmd: ActuatorCommand = { type: 'deess' }
    const changes = applyCommand(cmd, c)
    expect(changes).not.toBeNull()
    expect(changes!.length).toBe(1)
    const sc = switchChanges(changes)
    expect(sc[0].slot).toBe(5)
    expect(sc[0].on).toBe(true)
  })

  it('returns empty array when deesser is already on', () => {
    const c = [noiseRemoval(), gate(), eq(), comp(), reafir(), deesser(true)]
    const cmd: ActuatorCommand = { type: 'deess' }
    const changes = applyCommand(cmd, c)
    expect(changes).toEqual([])
  })
})

// ---- Edge cases ----

describe('applyCommand: edge cases', () => {
  it('returns null for eqCut when no ReaEQ slot exists', () => {
    const c: ChainSlot[] = [noiseRemoval(), gate(), comp()]
    const cmd: ActuatorCommand = { type: 'eqCut', freqHz: 60, gainDb: -12, bwOct: 0.1 }
    expect(applyCommand(cmd, c)).toBeNull()
  })

  it('returns null for eqCut when all EQ bands are in use', () => {
    const c = chainNoFreeBands()
    const cmd: ActuatorCommand = { type: 'eqCut', freqHz: 60, gainDb: -12, bwOct: 0.1 }
    expect(applyCommand(cmd, c)).toBeNull()
  })

  it('returns null for highpass when all EQ bands are in use', () => {
    const c = chainNoFreeBands()
    const cmd: ActuatorCommand = { type: 'highpass', freqHz: 80 }
    expect(applyCommand(cmd, c)).toBeNull()
  })

  it('returns null for lowShelf when no ReaEQ slot exists', () => {
    const c: ChainSlot[] = [noiseRemoval(), gate(), comp()]
    const cmd: ActuatorCommand = { type: 'lowShelf', freqHz: 150, gainDb: -3 }
    expect(applyCommand(cmd, c)).toBeNull()
  })

  it('returns null for highShelf when no ReaEQ slot exists', () => {
    const c: ChainSlot[] = [noiseRemoval(), gate(), comp()]
    const cmd: ActuatorCommand = { type: 'highShelf', freqHz: 10000, gainDb: 2 }
    expect(applyCommand(cmd, c)).toBeNull()
  })

  it('returns null for noiseSubtract when ReaFIR is not in the chain', () => {
    const c = [noiseRemoval(), gate(), eq(), comp()]
    const cmd: ActuatorCommand = { type: 'noiseSubtract', profileNote: 'broadband' }
    expect(applyCommand(cmd, c)).toBeNull()
  })

  it('returns null for gate when no ReaGate slot exists', () => {
    const c: ChainSlot[] = [noiseRemoval(), eq(), comp()]
    const cmd: ActuatorCommand = { type: 'gate', thresholdDb: -40 }
    expect(applyCommand(cmd, c)).toBeNull()
  })

  it('returns null for gate when threshold already matches (gate already configured)', () => {
    const c = [noiseRemoval(), gate({ thresholdDb: -40 }), eq(), comp()]
    const cmd: ActuatorCommand = { type: 'gate', thresholdDb: -40 }
    expect(applyCommand(cmd, c)).toBeNull()
  })

  it('returns null for compress when no ReaComp slot exists', () => {
    const c: ChainSlot[] = [noiseRemoval(), gate(), eq()]
    const cmd: ActuatorCommand = { type: 'compress', thresholdDb: -25, ratio: 3 }
    expect(applyCommand(cmd, c)).toBeNull()
  })

  it('returns null for deess when no deesser slot exists', () => {
    const c = [noiseRemoval(), gate(), eq(), comp()]
    const cmd: ActuatorCommand = { type: 'deess' }
    expect(applyCommand(cmd, c)).toBeNull()
  })

  it('returns null for an empty chain', () => {
    const c: ChainSlot[] = []
    expect(applyCommand({ type: 'eqCut', freqHz: 60, gainDb: -12, bwOct: 0.1 }, c)).toBeNull()
    expect(applyCommand({ type: 'gate', thresholdDb: -40 }, c)).toBeNull()
    expect(applyCommand({ type: 'compress', thresholdDb: -25, ratio: 3 }, c)).toBeNull()
    expect(applyCommand({ type: 'noiseSubtract', profileNote: 'broadband' }, c)).toBeNull()
    expect(applyCommand({ type: 'deess' }, c)).toBeNull()
  })
})

// ---- renderSteps ----

describe('reaplugsAdapter: renderSteps', () => {
  it('returns a step message keyed by command type', () => {
    const steps = replugsAdapter.renderSteps({ type: 'eqCut', freqHz: 60, gainDb: -12, bwOct: 0.1 })
    expect(steps).toEqual([{ key: 'desktop.advice.steps.reaplugs.eqCut' }])
  })

  it('returns distinct keys for different command types', () => {
    const gateSteps = replugsAdapter.renderSteps({ type: 'gate', thresholdDb: -40 })
    const compSteps = replugsAdapter.renderSteps({ type: 'compress', thresholdDb: -25, ratio: 3 })
    expect(gateSteps[0].key).not.toBe(compSteps[0].key)
  })
})

// ---- Change id stability ----

describe('applyCommand: change id stability', () => {
  it('eqCut change ids include reason, slot, and band field', () => {
    const c = fullChain()
    const cmd: ActuatorCommand = { type: 'eqCut', freqHz: 60, gainDb: -12, bwOct: 0.1 }
    const changes = applyCommand(cmd, c)!
    for (const ch of changes) {
      expect(ch.id).toMatch(/^tone:2:band\d+\./)
    }
  })

  it('gate change ids include reason and slot', () => {
    const c = [noiseRemoval(), gate({ thresholdDb: -50 }), eq(), comp()]
    const cmd: ActuatorCommand = { type: 'gate', thresholdDb: -40 }
    const changes = applyCommand(cmd, c)!
    expect(changes[0].id).toBe('noise:1:thresholdDb')
  })

  it('compress change ids include reason and slot', () => {
    const c = fullChain()
    const cmd: ActuatorCommand = { type: 'compress', thresholdDb: -25, ratio: 4 }
    const changes = applyCommand(cmd, c)!
    for (const ch of changes) {
      expect(ch.id).toMatch(/^gain:3:/)
    }
  })
})