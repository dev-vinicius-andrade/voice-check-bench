// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { fmtClock } from '../../i18n/format'
import { downloadErrorMsg, takeFileName, takeWav } from './takeFile'

describe('takeFileName', () => {
  it('names the side and the local date and time to the minute', () => {
    const at = new Date(2026, 10, 18, 3, 12, 45)
    expect(takeFileName('before', at)).toBe('voice-check-before-2026-11-18-0312.wav')
    expect(takeFileName('after', new Date(2026, 0, 5, 14, 7))).toBe('voice-check-after-2026-01-05-1407.wav')
  })
})

describe('takeWav', () => {
  it('is a 16-bit PCM mono WAV at 48 kHz, clamped to full scale', () => {
    const wav = takeWav(new Float32Array([0, 0.5, -0.5, 2, -2, 1, -1]))
    const v = new DataView(wav)
    const text = (o: number, n: number): string => String.fromCharCode(...new Uint8Array(wav, o, n))
    expect(text(0, 4)).toBe('RIFF')
    expect(text(8, 4)).toBe('WAVE')
    expect(text(12, 4)).toBe('fmt ')
    expect(v.getUint16(20, true)).toBe(1) // PCM
    expect(v.getUint16(22, true)).toBe(1) // mono
    expect(v.getUint32(24, true)).toBe(48000)
    expect(v.getUint32(28, true)).toBe(96000) // byte rate
    expect(v.getUint16(34, true)).toBe(16)
    expect(text(36, 4)).toBe('data')
    expect(v.getUint32(40, true)).toBe(14)
    expect(wav.byteLength).toBe(44 + 14)
    const pcm = Array.from({ length: 7 }, (_, i) => v.getInt16(44 + 2 * i, true))
    expect(pcm).toEqual([0, 16384, -16384, 32767, -32768, 32767, -32768])
  })
})

describe('downloadErrorMsg', () => {
  it('says plainly what went wrong', () => {
    expect(downloadErrorMsg({ code: 'noFolder', message: 'x' })).toEqual({ key: 'desktop.autotune.ui.result.download.noFolder' })
    expect(downloadErrorMsg({ code: 'writeFailed', message: 'x' })).toEqual({ key: 'desktop.autotune.ui.result.download.writeFailed' })
    expect(downloadErrorMsg({ code: 'invalidName', message: 'bad name' })).toEqual({ key: 'desktop.errors.other', params: { message: 'bad name' } })
    expect(downloadErrorMsg(new Error('boom'))).toEqual({ key: 'desktop.errors.other', params: { message: 'boom' } })
  })
})

describe('fmtClock', () => {
  it('shows m:ss, rounded down', () => {
    expect(fmtClock(0)).toBe('0:00')
    expect(fmtClock(4.9)).toBe('0:04')
    expect(fmtClock(25)).toBe('0:25')
    expect(fmtClock(85.2)).toBe('1:25')
    expect(fmtClock(-3)).toBe('0:00')
    expect(fmtClock(Number.NaN)).toBe('0:00')
  })
})
