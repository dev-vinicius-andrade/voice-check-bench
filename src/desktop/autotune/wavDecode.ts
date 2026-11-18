// "Use a WAV file" for Tune from a recording: RIFF/WAVE PCM 16/24/32-bit integer or 32/64-bit float, mono or stereo
// (WAVE_FORMAT_EXTENSIBLE too) → mono (channels averaged) at 48 kHz (linear resampling), at most MAX_SEC seconds.
// Framework-free.
import { MAX_SEC } from '../../audio/reference'
import { TUNE_SAMPLE_RATE } from '../tune/measure'

/** Shorter files are refused: the tuner needs the quiet lead and enough talking. */
export const MIN_WAV_SEC = 10

export type WavProblem = 'notWav' | 'format' | 'tooShort'

export type WavDecoded =
  | { ok: true; take: Float32Array; seconds: number; sourceRate: number; channels: number }
  | { ok: false; reason: WavProblem }

interface Fmt {
  format: number
  channels: number
  rate: number
  bits: number
}

const tag = (v: DataView, at: number): string =>
  String.fromCharCode(v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2), v.getUint8(at + 3))

function readFmt(v: DataView, at: number, size: number): Fmt | null {
  if (size < 16) return null
  let format = v.getUint16(at, true)
  // WAVE_FORMAT_EXTENSIBLE: the real format is the first two bytes of the sub-format GUID
  if (format === 0xfffe && size >= 40) format = v.getUint16(at + 24, true)
  return { format, channels: v.getUint16(at + 2, true), rate: v.getUint32(at + 4, true), bits: v.getUint16(at + 14, true) }
}

/** One sample → −1..1 (integers scaled by their full scale, floats as they are). */
function sampleReader(f: Fmt): ((v: DataView, at: number) => number) | null {
  if (f.format === 1 && f.bits === 16) return (v, at) => v.getInt16(at, true) / 32768
  if (f.format === 1 && f.bits === 24)
    return (v, at) => {
      const n = v.getUint8(at) | (v.getUint8(at + 1) << 8) | (v.getInt8(at + 2) << 16)
      return n / 8388608
    }
  if (f.format === 1 && f.bits === 32) return (v, at) => v.getInt32(at, true) / 2147483648
  if (f.format === 3 && f.bits === 32) return (v, at) => v.getFloat32(at, true)
  if (f.format === 3 && f.bits === 64) return (v, at) => v.getFloat64(at, true)
  return null
}

/** Linear interpolation to `to` Hz (same samples when the rate already matches). */
export function resampleLinear(x: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return x
  const n = Math.max(0, Math.floor((x.length * to) / from))
  const out = new Float32Array(n)
  const step = from / to
  for (let i = 0; i < n; i++) {
    const p = i * step
    const j = Math.floor(p)
    const a = x[j] ?? 0
    const b = x[j + 1] ?? a
    out[i] = a + (b - a) * (p - j)
  }
  return out
}

export function decodeWav(buf: ArrayBuffer): WavDecoded {
  const v = new DataView(buf)
  if (v.byteLength < 12 || tag(v, 0) !== 'RIFF' || tag(v, 8) !== 'WAVE') return { ok: false, reason: 'notWav' }
  let fmt: Fmt | null = null
  let data: { at: number; size: number } | null = null
  for (let at = 12; at + 8 <= v.byteLength; ) {
    const id = tag(v, at)
    const size = v.getUint32(at + 4, true)
    const body = at + 8
    if (id === 'fmt ') fmt = readFmt(v, body, Math.min(size, v.byteLength - body))
    if (id === 'data') data = { at: body, size: Math.min(size, v.byteLength - body) }
    at = body + size + (size % 2)
  }
  if (!fmt || !data) return { ok: false, reason: 'notWav' }
  const read = sampleReader(fmt)
  if (!read || fmt.channels < 1 || fmt.channels > 2 || fmt.rate < 8000 || fmt.rate > 384000) return { ok: false, reason: 'format' }
  const bytes = fmt.bits / 8
  const frameBytes = bytes * fmt.channels
  const frames = Math.min(Math.floor(data.size / frameBytes), Math.ceil(MAX_SEC * fmt.rate))
  if (frames / fmt.rate < MIN_WAV_SEC) return { ok: false, reason: 'tooShort' }
  const mono = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    let s = 0
    for (let c = 0; c < fmt.channels; c++) s += read(v, data.at + i * frameBytes + c * bytes)
    mono[i] = s / fmt.channels
  }
  const take = resampleLinear(mono, fmt.rate, TUNE_SAMPLE_RATE)
  return { ok: true, take, seconds: take.length / TUNE_SAMPLE_RATE, sourceRate: fmt.rate, channels: fmt.channels }
}
