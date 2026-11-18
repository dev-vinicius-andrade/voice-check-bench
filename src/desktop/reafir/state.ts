// ReaFIR (ReaPlugs) plugin state: read it and write a Subtract noise profile into it (SPEC "Cut the noise"). Framework-free.
// CONTRACT: the signatures and their meaning are fixed (hooks and the noise-cut plan are written against them).
//
// Layout, established on the real plugin (VST2 'refr') by load / export / render experiments:
// ParameterState = VST2 fxSet bank: 156-byte header (CcnK, byteSize, 'FBCh', 1, 'refr', fxVersion, …), big-endian
// int32 chunk size at 156, the chunk from 160 (effGetChunk, little-endian):
//   u32 lead      4763 = a profile follows; 4764 = none (a 4764 lead followed by a profile hangs the plugin)
//   profile       PROFILE_POINTS float32, token-coded (decodeProfile)
//   tail          f32 −90, f32 +24 (display range), i32 FFT size, f32 Show ana, f32 EQmode, i32 hasProfile,
//                 i32 nPoints, nPoints × (f32, i32), i32 mode (1 Gate, 2 Compressor, 4 Subtract; 0 EQ, 3 Convolve
//                 inferred), 5 × f32 parameters
// Profile point j is at j · 48000 / 8192 Hz, a linear per-bin magnitude; Subtract does |Y| = max(|X| − 2·P, 0).
import { b64decode, b64encode } from '../../wavelink/fxp'

/** A noise spectrum: level per frequency point, dBFS, on the app's plot scale (VoiceNoise.freqsHz / noiseDb). */
export interface NoiseProfile {
  freqsHz: ArrayLike<number>
  noiseDb: ArrayLike<number>
}

/** What the app reads of a ReaFIR state. */
export interface ReaFirInfo {
  mode: 'eq' | 'gate' | 'compressor' | 'convolve' | 'subtract' | 'other'
  fftSize: number
  /** A stored profile / curve is present. */
  hasProfile: boolean
}

/** VST2 id of ReaFIR. */
export const REAFIR_ID = 'refr'
/** Values in a ReaFIR profile. */
export const PROFILE_POINTS = 4096
/** Sample rate the profile's frequencies are laid out for (point j at j · rate / (2 · PROFILE_POINTS)). */
export const PROFILE_SAMPLE_RATE = 48000
/** Tail field `mode` for Subtract. */
export const MODE_SUBTRACT = 4
/** Subtract takes this multiple of the profile off each bin's magnitude (measured 1.96–2.0). */
export const SUBTRACT_FACTOR = 2
/** FFT size of the app's noise measurement (framer.ts power from a Hann FFT of this size). */
export const MEASURE_FFT = 4096
/**
 * The plugin's per-bin magnitude of a noise vs the app's framer.ts power of it at the same FFT size: −1.76 dB (no
 * window loss in the plugin: −10·log10(1.5)); measured −2.0 ± 0.3 dB with white noise.
 */
export const NOISE_TO_PLUGIN_DB = -10 * Math.log10(1.5)

const HEADER = 156
const CHUNK_AT = HEADER + 4
const LEAD_PROFILE = 4763
const LEAD_NONE = 4764
const MODES: Readonly<Record<number, ReaFirInfo['mode']>> = { 0: 'eq', 1: 'gate', 2: 'compressor', 3: 'convolve', 4: 'subtract' }
/** Lowest and highest profile value written (−180 dB … 0 dB). */
const MIN_VALUE = 1e-9
const MAX_VALUE = 1
const MAX_POINTS = 1024

const view = (b: Uint8Array): DataView => new DataView(b.buffer, b.byteOffset, b.byteLength)
const tag = (b: Uint8Array, o: number): string => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3])

interface Tail {
  fftSize: number
  hasProfile: boolean
  nPoints: number
  mode: number
  /** The whole tail as stored, written back byte for byte except hasProfile and mode. */
  raw: Uint8Array
}

interface Parsed {
  bank: Uint8Array
  /** End of the chunk in `bank` (bytes after it are kept as they are). */
  chunkEnd: number
  profile: Float32Array | null
  tail: Tail
}

/** Tail bytes for nPoints points: 6 fields, nPoints, the points, mode, 5 parameters. */
const tailSize = (nPoints: number): number => 4 * (13 + 2 * nPoints)

/** The tail starting at `at`; it must end exactly at the chunk's end. */
function readTail(chunk: Uint8Array, at: number): Tail | null {
  if (at + tailSize(0) > chunk.length) return null
  const v = view(chunk)
  const nPoints = v.getInt32(at + 24, true)
  if (nPoints < 0 || nPoints > MAX_POINTS || at + tailSize(nPoints) !== chunk.length) return null
  const hasProfile = v.getInt32(at + 20, true)
  if (hasProfile !== 0 && hasProfile !== 1) return null
  return { fftSize: v.getInt32(at + 8, true), hasProfile: hasProfile === 1, nPoints, mode: v.getInt32(at + 28 + 8 * nPoints, true), raw: chunk.slice(at) }
}

/**
 * Profile tokens, one byte then data: t < 0x80 → t + 1 literal float32; 0x80 → one copy of the previous value;
 * 0x81–0xff → (t & 0x7f) values, each 2·v[i−1] − v[i−2]. Null when the tokens do not make exactly PROFILE_POINTS.
 */
function decodeProfile(chunk: Uint8Array, from: number): { profile: Float32Array; end: number } | null {
  const v = view(chunk)
  const out = new Float32Array(PROFILE_POINTS)
  let n = 0
  let i = from
  while (n < PROFILE_POINTS) {
    if (i >= chunk.length) return null
    const t = chunk[i++]
    if (t < 0x80) {
      const k = t + 1
      if (n + k > PROFILE_POINTS || i + 4 * k > chunk.length) return null
      for (let j = 0; j < k; j++, i += 4) out[n++] = v.getFloat32(i, true)
    } else if (t === 0x80) {
      if (n < 1) return null
      out[n] = out[n - 1]
      n++
    } else {
      const k = t & 0x7f
      if (n < 2 || n + k > PROFILE_POINTS) return null
      for (let j = 0; j < k; j++, n++) out[n] = 2 * out[n - 1] - out[n - 2]
    }
  }
  return { profile: out, end: i }
}

/** Literal tokens only (lossless; the plugin reads them exactly and re-encodes on its next save). */
function encodeProfile(p: Float32Array): Uint8Array {
  const out = new Uint8Array(PROFILE_POINTS * 4 + Math.ceil(PROFILE_POINTS / 128))
  const v = view(out)
  let o = 0
  for (let i = 0; i < PROFILE_POINTS; i += 128) {
    const k = Math.min(128, PROFILE_POINTS - i)
    out[o++] = k - 1
    for (let j = 0; j < k; j++, o += 4) v.setFloat32(o, p[i + j], true)
  }
  return out
}

function parse(parameterState: string): Parsed | null {
  let bank: Uint8Array
  try {
    bank = b64decode(parameterState)
  } catch {
    return null
  }
  if (bank.length < CHUNK_AT + 4 || tag(bank, 0) !== 'CcnK' || tag(bank, 8) !== 'FBCh' || tag(bank, 16) !== REAFIR_ID) return null
  const size = view(bank).getInt32(HEADER, false)
  if (size < 4 || CHUNK_AT + size > bank.length) return null
  const chunk = bank.subarray(CHUNK_AT, CHUNK_AT + size)
  const lead = view(chunk).getUint32(0, true)
  if (lead === LEAD_NONE) {
    const tail = readTail(chunk, 4)
    return tail && !tail.hasProfile ? { bank, chunkEnd: CHUNK_AT + size, profile: null, tail } : null
  }
  if (lead !== LEAD_PROFILE) return null
  const p = decodeProfile(chunk, 4)
  const tail = p && readTail(chunk, p.end)
  return p && tail && tail.hasProfile ? { bank, chunkEnd: CHUNK_AT + size, profile: p.profile, tail } : null
}

/** Reads a base64 ParameterState of ReaFIR; null when it is not a ReaFIR state in the layout this module knows. */
export function readReaFir(parameterState: string): ReaFirInfo | null {
  const s = parse(parameterState)
  if (!s) return null
  return { mode: MODES[s.tail.mode] ?? 'other', fftSize: s.tail.fftSize, hasProfile: s.tail.hasProfile }
}

/** The stored profile of a ReaFIR state (linear per-bin magnitudes, PROFILE_POINTS); null without one or for an unknown layout. */
export function readReaFirProfile(parameterState: string): Float32Array | null {
  return parse(parameterState)?.profile ?? null
}

/** dB at `f` read from the noise curve: linear in dB over log frequency, held flat beyond either end. */
function noiseAt(n: NoiseProfile, f: number): number {
  const fs = n.freqsHz
  const last = fs.length - 1
  if (f <= fs[0]) return n.noiseDb[0]
  if (f >= fs[last]) return n.noiseDb[last]
  let lo = 0
  let hi = last
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (fs[mid] <= f) lo = mid
    else hi = mid
  }
  const t = Math.log(f / fs[lo]) / Math.log(fs[hi] / fs[lo])
  return n.noiseDb[lo] * (1 - t) + n.noiseDb[hi] * t
}

/**
 * The profile for `noise` at the plugin's `fftSize`, raised by `strengthDb`: profile dB = noise dB − 1.76
 * + 10·log10(MEASURE_FFT / fftSize) − 20·log10(SUBTRACT_FACTOR) + strengthDb, so Subtract at strength 0 takes off
 * the noise's RMS magnitude per bin. Values held to −180 … 0 dB.
 */
function profileFromNoise(noise: NoiseProfile, fftSize: number, strengthDb: number): Float32Array {
  const offset = NOISE_TO_PLUGIN_DB + 10 * Math.log10(MEASURE_FFT / fftSize) - 20 * Math.log10(SUBTRACT_FACTOR) + strengthDb
  const out = new Float32Array(PROFILE_POINTS)
  for (let j = 0; j < PROFILE_POINTS; j++) {
    const db = noiseAt(noise, Math.max((j * PROFILE_SAMPLE_RATE) / (2 * PROFILE_POINTS), 1e-3))
    const v = Number.isFinite(db) ? 10 ** ((db + offset) / 20) : MIN_VALUE
    out[j] = Math.min(MAX_VALUE, Math.max(MIN_VALUE, v))
  }
  return out
}

const usableNoise = (n: NoiseProfile): boolean => {
  if (n.freqsHz.length < 2 || n.freqsHz.length !== n.noiseDb.length) return false
  for (let i = 0; i < n.freqsHz.length; i++) if (!(n.freqsHz[i] > 0) || (i > 0 && !(n.freqsHz[i] > n.freqsHz[i - 1]))) return false
  return true
}

/**
 * `parameterState` with mode Subtract and `profile` as its noise profile, everything else kept. `strengthDb` 0
 * subtracts the measured noise (its RMS magnitude); positive is stronger, negative gentler. Null when the state is
 * not in the layout this module knows: never write a guessed layout (a malformed state hangs the plugin), which
 * includes a mode field that holds none of the known modes and an FFT size that is not positive. Also null for a
 * profile that cannot be read (fewer than two points, lengths that differ, frequencies not ascending) or a strength
 * that is not finite. Written: lead 4763, the profile as literal tokens, hasProfile 1, mode Subtract; the
 * header, the rest of the tail and any bytes after the chunk byte for byte (the header's FXP byteSize, offset 4, is
 * only updated when it is not 0, as the ReaEQ writer does).
 */
export function subtractState(parameterState: string, profile: NoiseProfile, strengthDb: number): string | null {
  if (!Number.isFinite(strengthDb) || !usableNoise(profile)) return null
  const s = parse(parameterState)
  // a mode outside the known ones means the fields are not where this module reads them: never write there
  if (!s || !(s.tail.fftSize > 0) || MODES[s.tail.mode] === undefined) return null
  const prof = encodeProfile(profileFromNoise(profile, s.tail.fftSize, strengthDb))
  const raw = s.tail.raw.slice()
  const tv = view(raw)
  tv.setInt32(20, 1, true)
  tv.setInt32(28 + 8 * s.tail.nPoints, MODE_SUBTRACT, true)
  const after = s.bank.subarray(s.chunkEnd)
  const size = 4 + prof.length + raw.length
  const out = new Uint8Array(CHUNK_AT + size + after.length)
  out.set(s.bank.subarray(0, HEADER), 0)
  const v = view(out)
  v.setInt32(HEADER, size, false)
  v.setUint32(CHUNK_AT, LEAD_PROFILE, true)
  out.set(prof, CHUNK_AT + 4)
  out.set(raw, CHUNK_AT + 4 + prof.length)
  out.set(after, CHUNK_AT + size)
  if (v.getInt32(4, false) !== 0) v.setInt32(4, out.length - 8, false)
  return b64encode(out)
}
