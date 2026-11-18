// Minimal WAV read (PCM 16/24/32-bit int or 32-bit float, channels averaged to mono) and write (16-bit PCM, clamped).

export function decodeWav(bytes: Uint8Array): { samples: Float32Array; sampleRate: number } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (o: number): string => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3])
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file')
  let fmt = 0
  let channels = 0
  let sampleRate = 0
  let bits = 0
  let dataOff = -1
  let dataLen = 0
  for (let o = 12; o + 8 <= bytes.length; ) {
    const id = tag(o)
    const len = v.getUint32(o + 4, true)
    if (id === 'fmt ') {
      fmt = v.getUint16(o + 8, true)
      channels = v.getUint16(o + 10, true)
      sampleRate = v.getUint32(o + 12, true)
      bits = v.getUint16(o + 22, true)
      if (fmt === 0xfffe) fmt = v.getUint16(o + 32, true)
    } else if (id === 'data') {
      dataOff = o + 8
      dataLen = Math.min(len, bytes.length - dataOff)
      break
    }
    o += 8 + len + (len & 1)
  }
  if (dataOff < 0) throw new Error('no data chunk')
  const bps = bits / 8
  const frames = Math.floor(dataLen / (bps * channels))
  const out = new Float32Array(frames)
  const read = (o: number): number => {
    if (fmt === 3) return v.getFloat32(o, true)
    if (bits === 16) return v.getInt16(o, true) / 32768
    if (bits === 24) return ((v.getUint8(o) | (v.getUint8(o + 1) << 8) | (v.getInt8(o + 2) << 16)) / 8388608)
    return v.getInt32(o, true) / 2147483648
  }
  for (let i = 0; i < frames; i++) {
    let s = 0
    for (let c = 0; c < channels; c++) s += read(dataOff + (i * channels + c) * bps)
    out[i] = s / channels
  }
  return { samples: out, sampleRate }
}

/** Windowed-sinc resampling (Hann, 32 zero crossings), for a take that is not at 48 kHz. */
export function resample(x: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return x
  const ratio = to / from
  const n = Math.floor(x.length * ratio)
  const out = new Float32Array(n)
  const cutoff = Math.min(1, ratio)
  const half = 32
  for (let i = 0; i < n; i++) {
    const t = i / ratio
    const c = Math.floor(t)
    let s = 0
    let w = 0
    for (let k = c - half + 1; k <= c + half; k++) {
      if (k < 0 || k >= x.length) continue
      const d = t - k
      const sinc = d === 0 ? 1 : Math.sin(Math.PI * d * cutoff) / (Math.PI * d * cutoff)
      const win = 0.5 + 0.5 * Math.cos((Math.PI * d) / half)
      s += x[k] * sinc * win
      w += sinc * win
    }
    out[i] = w ? s / w : 0
  }
  return out
}

/** 16-bit mono PCM WAV, samples clamped to ±1 (for listening). */
export function encodeWav16(x: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + x.length * 2)
  const v = new DataView(bytes.buffer)
  const str = (o: number, s: string): void => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)))
  str(0, 'RIFF')
  v.setUint32(4, 36 + x.length * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, x.length * 2, true)
  for (let i = 0; i < x.length; i++) v.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, x[i])) * 32767), true)
  return bytes
}
