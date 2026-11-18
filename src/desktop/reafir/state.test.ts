import { describe, expect, it } from 'vitest'
import { b64decode, b64encode } from '../../wavelink/fxp'
import { MODE_SUBTRACT, PROFILE_POINTS, readReaFir, readReaFirProfile, subtractState } from './state'

// Synthetic ReaFIR states, laid out as the real plugin saves them (VST2 fxSet bank, 'FBCh', 'refr').

interface Spec {
  lead?: number
  /** Profile tokens as bytes (null: none). */
  tokens?: Uint8Array | null
  fftSize?: number
  hasProfile?: number
  points?: [number, number][]
  mode?: number
  params?: number[]
  /** FXP byteSize at offset 4 (0 as the plugin saves it). */
  byteSize?: number
  /** Bytes after the chunk. */
  after?: number[]
  /** The id at offset 16. */
  id?: string
}

const ascii = (b: Uint8Array, at: number, s: string): void => {
  for (let i = 0; i < 4; i++) b[at + i] = s.charCodeAt(i)
}

/** Literal tokens for `values` (runs of up to 128). */
function literal(values: readonly number[]): Uint8Array {
  const out: number[] = []
  for (let i = 0; i < values.length; i += 128) {
    const run = values.slice(i, i + 128)
    out.push(run.length - 1)
    const f = new Uint8Array(new Float32Array(run).buffer)
    out.push(...f)
  }
  return Uint8Array.from(out)
}

const flat = (v: number): number[] => Array.from({ length: PROFILE_POINTS }, () => v)

function bank(s: Spec = {}): Uint8Array {
  const points = s.points ?? [[382.45, 0], [3202.73, 0]]
  const tokens = s.tokens === undefined ? literal(flat(0.01)) : s.tokens
  const tail = new DataView(new ArrayBuffer(4 * (13 + 2 * points.length)))
  tail.setFloat32(0, -90, true)
  tail.setFloat32(4, 24, true)
  tail.setInt32(8, s.fftSize ?? 4096, true)
  tail.setFloat32(12, 1, true)
  tail.setFloat32(16, 0, true)
  tail.setInt32(20, s.hasProfile ?? (tokens ? 1 : 0), true)
  tail.setInt32(24, points.length, true)
  points.forEach(([a, b], k) => {
    tail.setFloat32(28 + 8 * k, a, true)
    tail.setInt32(32 + 8 * k, b, true)
  })
  const at = 28 + 8 * points.length
  tail.setInt32(at, s.mode ?? MODE_SUBTRACT, true)
  ;(s.params ?? [0.008, 0.9998, 3.16e-5, 0, 0.25]).forEach((p, k) => tail.setFloat32(at + 4 + 4 * k, p, true))
  const tailBytes = new Uint8Array(tail.buffer)
  const prof = tokens ?? new Uint8Array(0)
  const size = 4 + prof.length + tailBytes.length
  const after = Uint8Array.from(s.after ?? [])
  const out = new Uint8Array(160 + size + after.length)
  const v = new DataView(out.buffer)
  ascii(out, 0, 'CcnK')
  v.setInt32(4, s.byteSize ?? 0, false)
  ascii(out, 8, 'FBCh')
  v.setInt32(12, 1, false)
  ascii(out, 16, s.id ?? 'refr')
  v.setInt32(20, 1100, false)
  for (let i = 24; i < 156; i++) out[i] = i & 0xff
  v.setInt32(156, size, false)
  v.setUint32(160, s.lead ?? (tokens ? 4763 : 4764), true)
  out.set(prof, 164)
  out.set(tailBytes, 164 + prof.length)
  out.set(after, 160 + size)
  return out
}

const state = (s: Spec = {}): string => b64encode(bank(s))
const db = (v: number): number => 20 * Math.log10(v)
/** Profile point j's frequency, Hz. */
const hzOf = (j: number): number => (j * 48000) / 8192

describe('readReaFir', () => {
  it('reads mode, FFT size and the stored profile of literal tokens', () => {
    const values = Array.from({ length: PROFILE_POINTS }, (_, j) => Math.fround(1 / (j + 1)))
    const s = state({ tokens: literal(values), fftSize: 8192 })
    expect(readReaFir(s)).toEqual({ mode: 'subtract', fftSize: 8192, hasProfile: true })
    expect(Array.from(readReaFirProfile(s) ?? [])).toEqual(values)
  })

  it('reads copy (0x80) and extrapolation (0x81–0xff) tokens', () => {
    const f32 = (...v: number[]): number[] => [...new Uint8Array(new Float32Array(v).buffer)]
    // 1, 2 literal; one copy (2); 3 extrapolated (2, 2, 2: the slope is 0 after a copy) … then 1, 3 literal and 4 extrapolated (5, 7, 9, 11)
    const head = [1, ...f32(1, 2), 0x80, 0x83, 1, ...f32(1, 3), 0x84]
    const done = 2 + 1 + 3 + 2 + 4
    const rest = literal(Array.from({ length: PROFILE_POINTS - done }, () => 0.5))
    const p = readReaFirProfile(state({ tokens: Uint8Array.from([...head, ...rest]) }))
    expect(Array.from(p?.subarray(0, done) ?? [])).toEqual([1, 2, 2, 2, 2, 2, 1, 3, 5, 7, 9, 11])
    expect(p?.[done]).toBeCloseTo(0.5, 9)
    expect(p?.length).toBe(PROFILE_POINTS)
  })

  it('names the modes; an unknown mode is other', () => {
    const modes: [number, string][] = [[0, 'eq'], [1, 'gate'], [2, 'compressor'], [3, 'convolve'], [4, 'subtract'], [7, 'other']]
    for (const [mode, name] of modes) expect(readReaFir(state({ mode }))?.mode).toBe(name)
  })

  it('reads every FFT size and any number of points', () => {
    for (const fftSize of [256, 1024, 2048, 4096, 8192, 16384, 32768]) expect(readReaFir(state({ fftSize }))?.fftSize).toBe(fftSize)
    for (const points of [[], [[1000, 1]], [[100, 0], [1000, 1], [5000, 0]]] as [number, number][][]) {
      expect(readReaFir(state({ points, mode: 1 }))).toEqual({ mode: 'gate', fftSize: 4096, hasProfile: true })
    }
  })

  it('a state saved without a profile (lead 4764, hasProfile 0)', () => {
    const s = state({ tokens: null, mode: 0 })
    expect(readReaFir(s)).toEqual({ mode: 'eq', fftSize: 4096, hasProfile: false })
    expect(readReaFirProfile(s)).toBeNull()
  })

  it('keeps reading a state with bytes after its chunk', () => {
    expect(readReaFir(state({ after: [1, 2, 3] }))).toEqual({ mode: 'subtract', fftSize: 4096, hasProfile: true })
  })

  it('null for anything not in the known layout', () => {
    const good = bank()
    const with_ = (f: (b: Uint8Array) => void): string => {
      const b = good.slice()
      f(b)
      return b64encode(b)
    }
    const bad: [string, string][] = [
      ['not base64', '%%%'],
      ['empty', ''],
      ['short', b64encode(good.subarray(0, 150))],
      ['not CcnK', with_((b) => ascii(b, 0, 'XXXX'))],
      ['an FxBk bank', with_((b) => ascii(b, 8, 'FxBk'))],
      ['another plugin', state({ id: 'reeq' })],
      ['chunk size past the end', with_((b) => new DataView(b.buffer).setInt32(156, good.length, false))],
      ['chunk size too small', with_((b) => new DataView(b.buffer).setInt32(156, 2, false))],
      ['unknown lead', state({ lead: 4765 })],
      ['4764 lead followed by a profile', state({ lead: 4764 })],
      ['4763 lead without a profile', state({ tokens: null, lead: 4763 })],
      ['4764 lead, hasProfile 1', state({ tokens: null, hasProfile: 1 })],
      ['hasProfile 0 after a profile', state({ hasProfile: 0 })],
      ['hasProfile 2', state({ hasProfile: 2 })],
      ['profile too short', state({ tokens: literal(flat(0.01).slice(1)) })],
      ['profile too long', state({ tokens: literal([...flat(0.01), 0.01]) })],
      ['copy first', state({ tokens: Uint8Array.from([0x80, ...literal(flat(0.01).slice(1))]) })],
      ['extrapolation without two values', state({ tokens: Uint8Array.from([0, 0, 0, 0, 0, 0x81, ...literal(flat(0.01).slice(2))]) })],
      ['nPoints that does not fit the chunk', with_((b) => new DataView(b.buffer).setInt32(b.length - 4 * (13 + 4) + 24, 3, true))],
      ['negative nPoints', with_((b) => new DataView(b.buffer).setInt32(b.length - 4 * (13 + 4) + 24, -1, true))],
    ]
    for (const [name, s] of bad) expect([name, readReaFir(s)]).toEqual([name, null])
  })
})

describe('subtractState', () => {
  const noise = { freqsHz: [1500, 3000], noiseDb: [-50, -70] }

  it('writes lead 4763, the profile, hasProfile 1 and Subtract; everything else byte for byte', () => {
    const before = bank({ mode: 1, fftSize: 2048, points: [[100, 0], [1000, 1], [5000, 0]], after: [9, 8, 7] })
    const out = subtractState(b64encode(before), noise, 0)
    expect(out).not.toBeNull()
    const b = b64decode(out ?? '')
    const v = new DataView(b.buffer)
    // header
    expect(Array.from(b.subarray(0, 156))).toEqual(Array.from(before.subarray(0, 156)))
    const size = v.getInt32(156, false)
    expect(160 + size + 3).toBe(b.length)
    expect(v.getUint32(160, true)).toBe(4763)
    // the tail: only hasProfile (20) and mode (after the 3 points) differ
    const tailLen = 4 * (13 + 6)
    const tailBefore = before.subarray(before.length - 3 - tailLen, before.length - 3)
    const tailAfter = b.subarray(b.length - 3 - tailLen, b.length - 3)
    const differ = Array.from(tailAfter).flatMap((x, i) => (x !== tailBefore[i] ? [i] : []))
    expect(differ).toEqual([28 + 24])
    expect(new DataView(tailAfter.buffer, tailAfter.byteOffset).getInt32(28 + 24, true)).toBe(4)
    expect(new DataView(tailAfter.buffer, tailAfter.byteOffset).getInt32(20, true)).toBe(1)
    expect(Array.from(b.subarray(b.length - 3))).toEqual([9, 8, 7])
    expect(readReaFir(out ?? '')).toEqual({ mode: 'subtract', fftSize: 2048, hasProfile: true })
  })

  it('from a state without a profile: the profile is added and the result parses back as Subtract', () => {
    const before = bank({ tokens: null, mode: 0, hasProfile: 0 })
    const out = subtractState(b64encode(before), noise, 0) ?? ''
    expect(readReaFir(out)).toEqual({ mode: 'subtract', fftSize: 4096, hasProfile: true })
    expect(readReaFirProfile(out)?.length).toBe(PROFILE_POINTS)
    const b = b64decode(out)
    expect(new DataView(b.buffer).getUint32(160, true)).toBe(4763)
    // tail: hasProfile 0 → 1 and mode 0 → 4 only
    const tailLen = 4 * (13 + 4)
    const differ = Array.from(b.subarray(b.length - tailLen)).flatMap((x, i) => (x !== before[before.length - tailLen + i] ? [i] : []))
    expect(differ).toEqual([20, 28 + 16])
  })

  it('the profile: noise dB − 1.76 + 10·log10(4096 / FFT) − 6.02 + strength, read linearly in dB over log frequency', () => {
    const at = (s: string, j: number): number => db(readReaFirProfile(s)?.[j] ?? NaN)
    const s0 = subtractState(state(), noise, 0) ?? ''
    const off = -10 * Math.log10(1.5) - 20 * Math.log10(2)
    expect(off).toBeCloseTo(-7.78, 2)
    // j 256 = 1500 Hz, j 512 = 3000 Hz, j 362 between them
    expect(hzOf(256)).toBe(1500)
    expect(at(s0, 256)).toBeCloseTo(-50 + off, 3)
    expect(at(s0, 512)).toBeCloseTo(-70 + off, 3)
    expect(at(s0, 362)).toBeCloseTo(-50 - 20 * Math.log2(hzOf(362) / 1500) + off, 3)
    // held flat beyond either end (0 Hz included)
    expect(at(s0, 0)).toBeCloseTo(-50 + off, 3)
    expect(at(s0, 100)).toBeCloseTo(-50 + off, 3)
    expect(at(s0, 4095)).toBeCloseTo(-70 + off, 3)
    // strength and FFT size
    const s6 = subtractState(state(), noise, 6) ?? ''
    const sm6 = subtractState(state(), noise, -6) ?? ''
    const f8k = subtractState(state({ fftSize: 8192 }), noise, 0) ?? ''
    const f1k = subtractState(state({ fftSize: 1024 }), noise, 0) ?? ''
    for (const j of [0, 256, 362, 512, 3000]) {
      expect(at(s6, j) - at(s0, j)).toBeCloseTo(6, 3)
      expect(at(sm6, j) - at(s0, j)).toBeCloseTo(-6, 3)
      expect(at(f8k, j) - at(s0, j)).toBeCloseTo(-10 * Math.log10(2), 3)
      expect(at(f1k, j) - at(s0, j)).toBeCloseTo(10 * Math.log10(4), 3)
    }
  })

  it('profile values stay within −180 … 0 dB (a silent point, a loud one)', () => {
    const p = readReaFirProfile(subtractState(state(), { freqsHz: [100, 1000, 10000], noiseDb: [-200, 40, Number.NaN] }, 0) ?? '') ?? new Float32Array(0)
    expect(db(p[0])).toBeCloseTo(-180, 1)
    expect(p[170]).toBe(1)
    expect(db(p[4095])).toBeCloseTo(-180, 1)
  })

  it('the FXP byteSize is updated only when it was set', () => {
    const out = b64decode(subtractState(state({ byteSize: 1234 }), noise, 0) ?? '')
    expect(new DataView(out.buffer).getInt32(4, false)).toBe(out.length - 8)
    expect(new DataView(b64decode(subtractState(state(), noise, 0) ?? '').buffer).getInt32(4, false)).toBe(0)
  })

  it('null for an unknown layout, an unknown mode, a bad noise profile or strength', () => {
    expect(subtractState(state({ lead: 4765 }), noise, 0)).toBeNull()
    expect(subtractState(state({ id: 'reeq' }), noise, 0)).toBeNull()
    expect(subtractState('%%%', noise, 0)).toBeNull()
    expect(subtractState(state({ mode: 7 }), noise, 0)).toBeNull()
    expect(subtractState(state({ fftSize: 0 }), noise, 0)).toBeNull()
    expect(subtractState(state(), { freqsHz: [1000], noiseDb: [-60] }, 0)).toBeNull()
    expect(subtractState(state(), { freqsHz: [1000, 2000], noiseDb: [-60] }, 0)).toBeNull()
    expect(subtractState(state(), { freqsHz: [2000, 1000], noiseDb: [-60, -60] }, 0)).toBeNull()
    expect(subtractState(state(), noise, Number.NaN)).toBeNull()
  })
})
