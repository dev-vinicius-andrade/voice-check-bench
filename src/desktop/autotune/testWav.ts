// Test-only: WAV files in the formats "Use a WAV file" accepts (and a few it refuses).
export interface WavSpec {
  rate: number
  channels: number
  /** 1 PCM, 3 float; `extensible` wraps it in WAVE_FORMAT_EXTENSIBLE. */
  format: 1 | 3
  bits: 8 | 16 | 24 | 32 | 64
  extensible?: boolean
}

/** Interleaved samples (−1..1) → a RIFF/WAVE file, with a LIST chunk before `data` like real files have. */
export function encodeWav(frames: readonly (readonly number[])[], spec: WavSpec): ArrayBuffer {
  const bytes = spec.bits / 8
  const fmtSize = spec.extensible ? 40 : 16
  const dataSize = frames.length * spec.channels * bytes
  const list = 12
  const buf = new ArrayBuffer(12 + 8 + fmtSize + 8 + list + 8 + dataSize)
  const v = new DataView(buf)
  const str = (at: number, s: string): void => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)))
  str(0, 'RIFF')
  v.setUint32(4, buf.byteLength - 8, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, fmtSize, true)
  v.setUint16(20, spec.extensible ? 0xfffe : spec.format, true)
  v.setUint16(22, spec.channels, true)
  v.setUint32(24, spec.rate, true)
  v.setUint32(28, spec.rate * spec.channels * bytes, true)
  v.setUint16(32, spec.channels * bytes, true)
  v.setUint16(34, spec.bits, true)
  if (spec.extensible) {
    v.setUint16(36, 22, true)
    v.setUint16(38, spec.bits, true)
    v.setUint32(40, 0, true)
    v.setUint16(44, spec.format, true)
  }
  let at = 20 + fmtSize
  str(at, 'LIST')
  v.setUint32(at + 4, list, true)
  str(at + 8, 'INFOISFT')
  at += 8 + list
  str(at, 'data')
  v.setUint32(at + 4, dataSize, true)
  at += 8
  for (const f of frames)
    for (let c = 0; c < spec.channels; c++) {
      const x = f[c] ?? 0
      if (spec.format === 3 && spec.bits === 32) v.setFloat32(at, x, true)
      else if (spec.format === 3) v.setFloat64(at, x, true)
      else if (spec.bits === 16) v.setInt16(at, Math.round(x * 32767), true)
      else if (spec.bits === 24) {
        const n = Math.round(x * 8388607)
        v.setUint8(at, n & 0xff)
        v.setUint8(at + 1, (n >> 8) & 0xff)
        v.setInt8(at + 2, n >> 16)
      } else if (spec.bits === 32) v.setInt32(at, Math.round(x * 2147483647), true)
      else v.setUint8(at, Math.round(x * 127 + 128))
      at += bytes
    }
  return buf
}

/** Mono samples → frames for encodeWav (the same value on every channel when `channels` > 1). */
export const framesOf = (x: ArrayLike<number>, channels = 1): number[][] => Array.from(x, (s) => new Array<number>(channels).fill(s))
