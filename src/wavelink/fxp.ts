// ReaPlugs FXP blobs inside Wave Link's ParameterState (port of tools/apply-reaplugs.py; SPEC "Wave Link storage
// format"). ReaGate/ReaComp: FxBk bank, 156-byte header, FxCk program (56-byte header) of big-endian floats.
// ReaEQ: FBCh, 156-byte header, big-endian int32 chunk size, little-endian bands, tail kept as is. Framework-free.
import type { WlPluginState } from './types'

// ---------------------------------------------------------------- base64 (atob/btoa, browser and Node)

export function b64decode(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let k = 0; k < bin.length; k++) out[k] = bin.charCodeAt(k)
  return out
}

export function b64encode(bytes: Uint8Array): string {
  let bin = ''
  for (let k = 0; k < bytes.length; k += 0x8000) bin += String.fromCharCode(...bytes.subarray(k, k + 0x8000))
  return btoa(bin)
}

const view = (b: Uint8Array): DataView => new DataView(b.buffer, b.byteOffset, b.byteLength)
const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

/** True for a VST preset blob (magic CcnK). */
export const isFxp = (b: Uint8Array): boolean => b.length >= 8 && b[0] === 0x43 && b[1] === 0x63 && b[2] === 0x6e && b[3] === 0x4b

// ---------------------------------------------------------------- dB / amplitude and the normalized-parameter maps

export const db2a = (d: number): number => 10 ** (d / 20)
export const a2db = (a: number): number => (a > 0 ? 20 * Math.log10(a) : -Infinity)

interface ParamMap {
  index: number
  key: string
  /** Field label as the plugin window shows it. */
  label: string
  toValue: (v: number) => number | boolean
  fromValue: (v: number | boolean) => number
}
const num = (v: number | boolean): number => (typeof v === 'number' ? v : v ? 1 : 0)
const dbMap = (index: number, key: string, label: string): ParamMap => ({ index, key, label, toValue: a2db, fromValue: (v) => db2a(num(v)) })
const scaled = (index: number, key: string, label: string, k: number): ParamMap => ({
  index,
  key,
  label,
  toValue: (v) => v * k,
  fromValue: (v) => num(v) / k,
})

/** ReaGate parameters (verified against values set in the plugin UI), in GATE_KEYS order of the Python tool. */
export const GATE_PARAMS: readonly ParamMap[] = [
  dbMap(0, 'threshold', 'Threshold (dB)'),
  scaled(1, 'attack', 'Attack (ms)', 500),
  scaled(2, 'release', 'Release (ms)', 5000),
  scaled(4, 'hold', 'Hold (ms)', 1000),
  dbMap(9, 'dry', 'Dry (dB)'),
  dbMap(10, 'wet', 'Wet (dB)'),
  dbMap(12, 'hysteresis', 'Hysteresis (dB)'),
]

/** ReaComp parameters, in COMP_KEYS order of the Python tool. */
export const COMP_PARAMS: readonly ParamMap[] = [
  dbMap(0, 'threshold', 'Threshold (dB)'),
  { index: 1, key: 'ratio', label: 'Ratio', toValue: (v) => v * 99 + 1, fromValue: (v) => (num(v) - 1) / 99 },
  scaled(2, 'attack', 'Attack (ms)', 500),
  scaled(3, 'release', 'Release (ms)', 5000),
  dbMap(11, 'wet', 'Wet (dB)'),
  { index: 17, key: 'limit', label: 'Limit output', toValue: (v) => v >= 0.5, fromValue: (v) => (v ? 1 : 0) },
]

export const EQ_TYPES = { 'Low Shelf': 0, 'High Shelf': 1, Band: 8 } as const
export type EqTypeName = keyof typeof EQ_TYPES
const EQ_NAMES: Record<number, EqTypeName> = { 0: 'Low Shelf', 1: 'High Shelf', 8: 'Band' }
export const eqTypeName = (t: number): EqTypeName | 'Other' => EQ_NAMES[t] ?? 'Other'

// ---------------------------------------------------------------- FxBk (ReaGate / ReaComp)

export interface Bank {
  prefix: Uint8Array
  vals: number[]
  suffix: Uint8Array
}

const BANK_HEADER = 156
const PROGRAM_HEADER = 56

/** FxBk → prefix up to the parameter floats, the floats, the bytes after them (read_bank). */
export function readBank(blob: Uint8Array): Bank {
  if (!isFxp(blob) || blob.length < BANK_HEADER + PROGRAM_HEADER) throw new Error('not an FxBk bank')
  const n = view(blob).getInt32(BANK_HEADER + 24)
  const end = BANK_HEADER + PROGRAM_HEADER + 4 * n
  if (n < 0 || end > blob.length) throw new Error('bad parameter count')
  const dv = view(blob)
  const vals = Array.from({ length: n }, (_, k) => dv.getFloat32(BANK_HEADER + PROGRAM_HEADER + 4 * k))
  return { prefix: blob.slice(0, BANK_HEADER + PROGRAM_HEADER), vals, suffix: blob.slice(end) }
}

/**
 * FxBk with new parameter floats (write_bank). Only the indices in `changed` are re-packed; the others keep their
 * original bytes, so an unchanged value (even a NaN) stays byte-identical. Without `changed`, all are re-packed.
 */
export function writeBank(bank: Bank, original?: Uint8Array, changed?: ReadonlySet<number>): Uint8Array {
  const body = new Uint8Array(4 * bank.vals.length)
  const dv = view(body)
  const start = bank.prefix.length
  bank.vals.forEach((v, k) => {
    if (original && changed && !changed.has(k)) body.set(original.subarray(start + 4 * k, start + 4 * k + 4), 4 * k)
    else dv.setFloat32(4 * k, v)
  })
  return concat(bank.prefix, body, bank.suffix)
}

// ---------------------------------------------------------------- FBCh (ReaEQ)

export interface EqRawBand {
  type: number
  enabled: number
  freq: number
  /** Linear gain. */
  gain: number
  bw: number
  flag: number
}

export interface EqChunk {
  header: Uint8Array
  ver: number
  bands: EqRawBand[]
  tail: Uint8Array
}

const BAND_BYTES = 33

/** FBCh → header, version, bands, tail (read_eq). */
export function readEq(blob: Uint8Array): EqChunk {
  if (!isFxp(blob) || blob.length < BANK_HEADER + 4 + 8) throw new Error('not an FBCh chunk')
  const size = view(blob).getInt32(BANK_HEADER)
  if (size < 8 || BANK_HEADER + 4 + size > blob.length) throw new Error('bad chunk size')
  const ch = blob.subarray(BANK_HEADER + 4, BANK_HEADER + 4 + size)
  const dv = view(ch)
  const ver = dv.getInt32(0, true)
  const n = dv.getInt32(4, true)
  if (n < 0 || 8 + n * BAND_BYTES > ch.length) throw new Error('bad band count')
  const bands: EqRawBand[] = []
  let o = 8
  for (let k = 0; k < n; k++, o += BAND_BYTES) {
    bands.push({
      type: dv.getInt32(o, true),
      enabled: dv.getInt32(o + 4, true),
      freq: dv.getFloat64(o + 8, true),
      gain: dv.getFloat64(o + 16, true),
      bw: dv.getFloat64(o + 24, true),
      flag: ch[o + 32],
    })
  }
  return { header: blob.slice(0, BANK_HEADER), ver, bands, tail: ch.slice(o) }
}

/** FBCh from bands (write_eq): chunk size at offset 156; FXP byteSize (offset 4) only updated when it was non-zero. */
export function writeEq({ header, ver, bands, tail }: EqChunk): Uint8Array {
  const ch = new Uint8Array(8 + bands.length * BAND_BYTES + tail.length)
  const dv = view(ch)
  dv.setInt32(0, ver, true)
  dv.setInt32(4, bands.length, true)
  bands.forEach((b, k) => {
    const o = 8 + k * BAND_BYTES
    dv.setInt32(o, b.type, true)
    dv.setInt32(o + 4, b.enabled, true)
    dv.setFloat64(o + 8, b.freq, true)
    dv.setFloat64(o + 16, b.gain, true)
    dv.setFloat64(o + 24, b.bw, true)
    ch[o + 32] = b.flag & 0xff
  })
  ch.set(tail, 8 + bands.length * BAND_BYTES)
  const size = new Uint8Array(4)
  view(size).setInt32(0, ch.length)
  const blob = concat(header, size, ch)
  if (view(header).getInt32(4) !== 0) view(blob).setInt32(4, blob.length - 8)
  return blob
}

// ---------------------------------------------------------------- decoded plugin states

export type CockosKind = 'reagate' | 'recomp' | 'reaeq'

const bankState = (params: readonly ParamMap[], vals: number[]): Record<string, number | boolean> =>
  Object.fromEntries(params.map((p) => [p.key, p.toValue(vals[p.index] ?? 0)]))

/** Decoded state of a ReaGate / ReaComp / ReaEQ blob. Throws on a malformed blob. */
export function decodeState(kind: CockosKind, blob: Uint8Array): WlPluginState {
  if (kind === 'reaeq') {
    const { bands } = readEq(blob)
    return {
      kind,
      bands: bands.map((b) => ({ type: eqTypeName(b.type), enabled: b.enabled !== 0, freq: b.freq, gain: a2db(b.gain), bw: b.bw })),
    }
  }
  const { vals } = readBank(blob)
  if (kind === 'reagate') return { kind, ...bankState(GATE_PARAMS, vals) } as WlPluginState
  return { kind, ...bankState(COMP_PARAMS, vals) } as WlPluginState
}

/** Decode → re-encode with unchanged values is byte-identical (the self-test of the Python tool). */
export function roundTrips(kind: CockosKind, blob: Uint8Array): boolean {
  try {
    const out = kind === 'reaeq' ? writeEq(readEq(blob)) : writeBank(readBank(blob))
    return out.length === blob.length && out.every((v, k) => v === blob[k])
  } catch {
    return false
  }
}
