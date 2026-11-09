// Test-only builders: synthetic ReaPlugs blobs and a small Wave Link Settings.json in Wave Link's own format.
import type { SuggestionJson } from '../settings/suggest'
import { b64encode, db2a, writeEq, type EqRawBand } from './fxp'
import { dotnetString } from './json'

const ascii = (s: string, into: Uint8Array, at: number) => {
  for (let k = 0; k < s.length; k++) into[at + k] = s.charCodeAt(k)
}

/** FxBk bank (156-byte header + FxCk program header) holding `vals` big-endian floats. */
export function bankBlob(vals: number[], suffix: number[] = []): Uint8Array {
  const b = new Uint8Array(156 + 56 + 4 * vals.length + suffix.length)
  const dv = new DataView(b.buffer)
  ascii('CcnK', b, 0)
  ascii('FxBk', b, 8)
  ascii('CcnK', b, 156)
  ascii('FxCk', b, 164)
  dv.setInt32(156 + 24, vals.length)
  vals.forEach((v, k) => dv.setFloat32(156 + 56 + 4 * k, v))
  b.set(suffix, 156 + 56 + 4 * vals.length)
  return b
}

/** ReaGate-like bank: threshold −40 dB, attack 2 ms, release 300 ms, hold 100 ms, dry −inf, wet 0, hysteresis −6. */
export function gateValues(): number[] {
  const v = new Array<number>(19).fill(0)
  v[0] = db2a(-40)
  v[1] = 2 / 500
  v[2] = 300 / 5000
  v[4] = 100 / 1000
  v[9] = 0
  v[10] = 1
  v[12] = db2a(-6)
  return v
}

/** ReaComp-like bank: threshold −20 dB, ratio 4, attack 3 ms, release 80 ms, wet +2 dB, limit off. */
export function compValues(): number[] {
  const v = new Array<number>(19).fill(0)
  v[0] = db2a(-20)
  v[1] = 3 / 99
  v[2] = 3 / 500
  v[3] = 80 / 5000
  v[11] = db2a(2)
  v[17] = 0
  return v
}

export const TAIL = Array.from({ length: 20 }, (_, k) => k)

/** FBCh ReaEQ chunk with these bands (gain linear), version 33 and a 20-byte tail. */
export function eqBlob(bands: EqRawBand[], byteSize = 0): Uint8Array {
  const header = new Uint8Array(156)
  ascii('CcnK', header, 0)
  new DataView(header.buffer).setInt32(4, byteSize)
  ascii('FBCh', header, 8)
  return writeEq({ header, ver: 33, bands, tail: Uint8Array.from(TAIL) })
}

export const band = (type: number, freq: number, gainDb: number, bw: number, enabled = 1): EqRawBand => ({
  type,
  enabled,
  freq,
  gain: db2a(gainDb),
  bw,
  flag: 1,
})

export interface FixturePlugin {
  name: string
  state: string
  bypass?: boolean
}

export const fixturePlugins = (): FixturePlugin[] => [
  { name: 'Elgato EQ', state: 'VkMyIQ==', bypass: false },
  { name: 'ReaGate (ReaPlugs Edition)', state: b64encode(bankBlob(gateValues())) },
  { name: 'ReaEQ (ReaPlugs Edition)', state: b64encode(eqBlob([band(0, 150, -4, 2), band(8, 3000, 2, 1)])) },
  { name: 'ReaComp (ReaPlugs Edition)', state: b64encode(bankBlob(compValues())) },
  { name: 'Elgato De-Esser', state: 'VkMyIQ==', bypass: true },
]

/** Settings.json the way Wave Link writes it: CRLF, 2-space indent, .NET escaping, no trailing newline. */
export function settingsText(plugins: FixturePlugin[] = fixturePlugins(), mic = 'DS1\\\\PCM_IN_01_C_00_SD1'): string {
  const pluginLines = plugins.map((p) =>
    [
      '          {',
      `            "Name": ${dotnetString(p.name)},`,
      '            "Vendor": "Cockos",',
      `            "ParameterState": ${dotnetString(p.state)},`,
      `            "BypassState": ${p.bypass ? 'true' : 'false'},`,
      '            "CustomName": null',
      '          }',
    ].join('\r\n'),
  )
  return [
    '{',
    '  "General": {',
    '    "Note": "Elgato\\u00AE \\u0022Wave\\u0022 \\u002B Link",',
    '    "Ratio": 0.75,',
    '    "Empty": [],',
    '    "1": 1',
    '  },',
    '  "MixerConfiguration": {',
    '    "InputSettings": {',
    '      "PCM_OUT_00_V_12_SD7": {',
    '        "InputName": "Music",',
    '        "AudioPluginConfigurations": []',
    '      },',
    `      "${mic}": {`,
    '        "InputName": "Wave XLR",',
    '        "AudioPluginConfigurations": [',
    pluginLines.join(',\r\n'),
    '        ]',
    '      }',
    '    }',
    '  }',
    '}',
  ].join('\r\n')
}

/** A full suggestion export (values of tools/example-settings.json). */
export function suggestionFixture(over: Partial<SuggestionJson> = {}): SuggestionJson {
  return {
    basedOn: 'Control · 8 cm',
    speechDbfs: -24.5,
    noiseDbfs: -68.2,
    gainHint: '',
    noiseHint: '',
    dist: '8 cm',
    lowcut: 80,
    gate: { threshold: -60, attack: 1, hold: 150, release: 200, hysteresis: -6, wet: 0, dry: -20 },
    eq: [
      { type: 'Low Shelf', freq: 150, gain: -4, bw: 2.0, why: 'Tame proximity boom' },
      { type: 'Band', freq: 1000, gain: 3, bw: 1.5, why: 'Add body and presence' },
      { type: 'Band', freq: 4000, gain: 3, bw: 1.4, why: 'Improve clarity' },
      { type: 'High Shelf', freq: 10000, gain: 1, bw: 2.0, why: 'A little air' },
    ],
    comp: { threshold: -34, ratio: 3, attack: 5, release: 100, knee: 6, wet: 12, limit: true },
    deess: false,
    noisyRoom: false,
    noiseReduction: null,
    chain: ['ReaGate', 'ReaEQ', 'ReaComp'],
    ...over,
  }
}
