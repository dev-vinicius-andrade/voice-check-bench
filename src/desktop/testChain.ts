// Test-only: an engine chain (AudioSlot) and the Wave Link entries it was built from, guide-like:
// Noise Removal (VST3) → ReaGate → ReaEQ → ReaComp → VoiceFocus (built in) → ReaFIR (off).
import { b64encode } from '../wavelink/fxp'
import { band, bankBlob, compValues, eqBlob, gateValues } from '../wavelink/testFixtures'
import type { AudioSlot, AudioStatus, ParamInfo, SlotStatus, WlChainEntry, WlSnapshot } from './types'

export const GATE = 'ReaGate (ReaPlugs Edition)'
export const COMP = 'ReaComp (ReaPlugs Edition)'
export const EQ = 'ReaEQ (ReaPlugs Edition)'
export const NR = 'Elgato Noise Removal'
export const FIR = 'ReaFIR (ReaPlugs Edition)'
export const INPUT_KEY = 'DS1\\PCM_IN_01_C_00_SD1'

export const params = (vals: number[]): ParamInfo[] => vals.map((v, id) => ({ id, name: `P${id}`, display: '', normalized: Math.fround(v), isBypass: false }))
const vst2: SlotStatus = { status: 'hosted', kind: 'vst2', pluginId: 'x', hasOwnBypass: false }
const vst3: SlotStatus = { status: 'hosted', kind: 'vst3', pluginId: 'y', hasOwnBypass: true }

export const slot = (index: number, name: string, p: ParamInfo[], status: SlotStatus = vst2, bypassed = false): AudioSlot => ({
  index,
  name,
  filePath: name ? `C:/${name}.dll` : '',
  status,
  bypassed,
  latencySamples: 0,
  fullLatencySamples: 0,
  params: p,
})

export const entry = (index: number, name: string, state: Uint8Array | null, bypassed = false, vendor = 'Cockos'): WlChainEntry => ({
  index,
  id: `id${index}`,
  name,
  vendor,
  filePath: '',
  pluginId: '',
  bypassed,
  parameterState: state ? b64encode(state) : '',
})

export const eqBytes = (): Uint8Array => eqBlob([band(0, 150, 0, 2), band(8, 3500, -2, 1.4), band(1, 10000, 1.5, 2)])
export const nrParams = (): ParamInfo[] => [
  { id: 773352680, name: 'Bypass', display: '', normalized: 0, isBypass: true },
  { id: 1163972580, name: 'VAD Threshold', display: '0.85', normalized: 0.85, isBypass: false },
]

/** ReaGate bank values; `dryAmp` 1 = Dry 0 dB (with Wet open the gate doubles the voice). */
export const gateBank = (dryAmp = 0): number[] => gateValues().map((v, k) => (k === 9 ? dryAmp : v))

export const engineSlots = (dryAmp = 0): AudioSlot[] => [
  slot(0, NR, nrParams(), vst3),
  slot(1, GATE, params(gateBank(dryAmp))),
  slot(2, EQ, []),
  slot(3, COMP, params(compValues())),
  slot(4, 'VoiceFocus', [], { status: 'builtIn' }),
  slot(5, FIR, [], vst2, true),
]

export const entries = (dryAmp = 0): WlChainEntry[] => [
  entry(0, NR, new Uint8Array([1, 2, 3]), false, 'Elgato'),
  entry(1, GATE, bankBlob(gateBank(dryAmp))),
  entry(2, EQ, eqBytes()),
  entry(3, COMP, bankBlob(compValues())),
  entry(4, 'VoiceFocus', null, false, 'Elgato'),
  entry(5, FIR, new Uint8Array([9]), true),
]

export const snapshot = (dryAmp = 0): WlSnapshot => ({ path: 'C:/Settings.json', hash: 'h1', inputs: [{ key: INPUT_KEY, label: 'Wave XLR', entries: entries(dryAmp) }] })

export const audioStatus = (dryAmp = 0): AudioStatus => ({
  source: { settingsPath: 'C:/Settings.json', inputKey: INPUT_KEY, inputLabel: 'Wave XLR' },
  input: { id: 'in1', name: 'Wave XLR', isSystemDefault: true },
  output: { id: 'out1', name: 'Headphones', isSystemDefault: true },
  sampleRate: 48000,
  blockSize: 480,
  monitor: 'off',
  gainDb: -10,
  latency: { alignedSamples: 480, activeSamples: 480 },
  settled: true,
  slots: engineSlots(dryAmp),
  counters: { blocks: 0, inputOverruns: 0, outputUnderruns: 0, monitorDropped: 0, streamDropped: 0, streamErrors: 0, processP50Us: 0, processP99Us: 0, processMaxUs: 0, blockUs: 10000 },
  lastStreamError: null,
})
