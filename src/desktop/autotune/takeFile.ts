// "Download" on the result step (SPEC "Tune from a recording — screen"): Before (the raw take) or After (the tuned
// render) as a WAV file for the Downloads folder (bridge.saveWav). Framework-free.
import { encodeWav } from '../../audio/wav'
import type { Msg } from '../../plain/types'

export type TakeSide = 'before' | 'after'

const pad = (n: number): string => String(n).padStart(2, '0')

/** `voice-check-<side>-<yyyy>-<mm>-<dd>-<hhmm>.wav` in local time, e.g. voice-check-before-2026-11-18-0312.wav. */
export function takeFileName(side: TakeSide, now: Date = new Date()): string {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  return `voice-check-${side}-${date}-${pad(now.getHours())}${pad(now.getMinutes())}.wav`
}

/** The samples as a 16-bit PCM mono WAV at `sampleRate` (48 kHz takes), clamped to ±1 (src/audio/wav.ts). */
export const takeWav = (samples: Float32Array, sampleRate = 48000): ArrayBuffer => encodeWav(samples, sampleRate)

const CODES = ['noFolder', 'writeFailed'] as const

/** A save_wav rejection ({ code, message }) → plain message; anything else says what went wrong. */
export function downloadErrorMsg(e: unknown): Msg {
  const code = typeof e === 'object' && e !== null && 'code' in e ? (e as { code: unknown }).code : null
  const known = CODES.find((c) => c === code)
  if (known) return { key: `desktop.autotune.ui.result.download.${known}` }
  const message = e instanceof Error ? e.message : typeof e === 'object' && e !== null && 'message' in e ? String((e as { message: unknown }).message) : String(e)
  return { key: 'desktop.errors.other', params: { message } }
}
