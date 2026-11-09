// @vitest-environment node
// Spot checks against real recordings (_test/*.wav, local and git-ignored). Each skips when its file is absent.
import { describe, expect, it } from 'vitest'
import { isAnalysisError, type Analysis } from '../types'
import { analyze } from './analyze'

interface NodeFs {
  existsSync(p: URL): boolean
  readFileSync(p: URL): Uint8Array
}
const fsModule = 'node:fs'
const fs = (await import(/* @vite-ignore */ fsModule)) as NodeFs
const wavUrl = new URL('../../_test/no-filters.wav', import.meta.url)
const present = fs.existsSync(wavUrl)
const noisyUrl = new URL('../../_test/control-2-cm-raw.wav', import.meta.url)
const noisyPresent = fs.existsSync(noisyUrl)

/** Minimal RIFF/WAVE PCM decoder (16- or 32-bit int, or 32-bit float), channels averaged to mono. */
function decodeWav(bytes: Uint8Array): { samples: Float32Array; sampleRate: number } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3])
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file')
  let fmt = 0, channels = 0, sampleRate = 0, bits = 0, dataOff = -1, dataLen = 0
  for (let o = 12; o + 8 <= bytes.length; ) {
    const id = tag(o)
    const len = v.getUint32(o + 4, true)
    if (id === 'fmt ') {
      fmt = v.getUint16(o + 8, true)
      channels = v.getUint16(o + 10, true)
      sampleRate = v.getUint32(o + 12, true)
      bits = v.getUint16(o + 22, true)
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
  for (let i = 0; i < frames; i++) {
    let s = 0
    for (let c = 0; c < channels; c++) {
      const o = dataOff + (i * channels + c) * bps
      if (fmt === 3 && bits === 32) s += v.getFloat32(o, true)
      else if (bits === 16) s += v.getInt16(o, true) / 32768
      else if (bits === 32) s += v.getInt32(o, true) / 2147483648
      else throw new Error(`unsupported WAV: format ${fmt}, ${bits} bit`)
    }
    out[i] = s / channels
  }
  return { samples: out, sampleRate }
}

describe.skipIf(!present)('analyze on _test/no-filters.wav', () => {
  it('is close to the prototype numbers', () => {
    const { samples, sampleRate } = decodeWav(fs.readFileSync(wavUrl))
    const r = analyze(samples, sampleRate)
    expect(isAnalysisError(r)).toBe(false)
    const a = r as Analysis
    expect(a.speechMed).toBeCloseTo(-49.6, 0)
    expect(Math.abs(a.noise - -93)).toBeLessThanOrEqual(1.5)
    const proto = [-12.8, 4.2, 8.6, 6.8, 0, 0.5, -1.6, -1.0, -14.3]
    a.rel.forEach((v, i) => expect(Math.abs(v - proto[i])).toBeLessThanOrEqual(0.5))
  })
})

describe.skipIf(!noisyPresent)('analyze on _test/control-2-cm-raw.wav (server + ceiling fan)', () => {
  it('reports a noisy, tonal or broadband room with fan/server tones', () => {
    const { samples, sampleRate } = decodeWav(fs.readFileSync(noisyUrl))
    const r = analyze(samples, sampleRate)
    expect(isAnalysisError(r)).toBe(false)
    const a = r as Analysis
    console.log('control-2-cm-raw', JSON.stringify({
      noise: +a.noise.toFixed(1),
      snr: +a.snr.toFixed(1),
      noiseKind: a.noiseKind,
      tones: a.tones,
      bandSnr: a.bandSnr.map((v) => +v.toFixed(1)),
    }))
    expect(a.noise).toBeGreaterThan(-45)
    expect(a.snr).toBeLessThan(20)
    expect(['tonal', 'broadband']).toContain(a.noiseKind)
    expect(a.bandSnr).toHaveLength(9)
    expect(a.tones.some((t) => Math.abs(t.hz - 780) <= 780 * 0.05 || Math.abs(t.hz - 1560) <= 1560 * 0.05)).toBe(true)
  })
})
