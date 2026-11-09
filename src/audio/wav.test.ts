import { describe, expect, it } from 'vitest'
import { encodeWav, wavFileName } from './wav'

describe('encodeWav', () => {
  it('writes a valid 16-bit mono header and clamps samples', () => {
    const buf = encodeWav(new Float32Array([0, 1, -1, 2]), 48000)
    const v = new DataView(buf)
    const tag = (o: number) => String.fromCharCode(...new Uint8Array(buf, o, 4))
    expect(tag(0)).toBe('RIFF')
    expect(tag(8)).toBe('WAVE')
    expect(tag(36)).toBe('data')
    expect(v.getUint32(24, true)).toBe(48000)
    expect(v.getUint16(22, true)).toBe(1)
    expect(v.getUint32(40, true)).toBe(8)
    expect(v.getInt16(46, true)).toBe(32767)
    expect(v.getInt16(48, true)).toBe(-32768)
    expect(v.getInt16(50, true)).toBe(32767)
  })
  it('makes a safe file name', () => {
    expect(wavFileName('Control · 2 cm · raw')).toBe('control-2-cm-raw.wav')
  })
})
