import { describe, expect, it } from 'vitest'
import { AUDIO_FRAME_VERSION, decodeAudioFrame } from './audioFrame'
import fixture from './audioFrame.fixture.json'

/** The fixture's hex (written by the Rust encoder test) as an ArrayBuffer. */
function fixtureBuffer(): ArrayBuffer {
  const bytes = new Uint8Array(fixture.hex.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(fixture.hex.slice(2 * i, 2 * i + 2), 16)
  return bytes.buffer
}

describe('decodeAudioFrame', () => {
  it('reads the frame the Rust encoder writes (shared fixture)', () => {
    const frame = decodeAudioFrame(fixtureBuffer())
    expect(frame).not.toBeNull()
    const { raw, processed, ...rest } = frame!
    const { raw: rawWant, processed: processedWant, ...restWant } = fixture.frame
    expect(rest).toEqual(restWant)
    expect(Array.from(raw)).toEqual(rawWant)
    expect(Array.from(processed)).toEqual(processedWant)
  })

  it('rejects another version, a short buffer and a wrong length', () => {
    const buf = fixtureBuffer()
    const other = buf.slice(0)
    new DataView(other).setUint32(0, AUDIO_FRAME_VERSION + 1, true)
    expect(decodeAudioFrame(other)).toBeNull()
    expect(decodeAudioFrame(buf.slice(0, 40))).toBeNull()
    expect(decodeAudioFrame(buf.slice(0, buf.byteLength - 4))).toBeNull()
  })

  it('copies the samples out of the message buffer', () => {
    const buf = fixtureBuffer()
    const frame = decodeAudioFrame(buf)!
    new Uint8Array(buf).fill(0)
    expect(frame.raw[0]).toBe(0.5)
  })
})
