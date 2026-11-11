// Engine errors ({ code, message } from the audio_* and wavelink_* commands) → plain messages. Framework-free.
import type { Msg } from '../plain/types'
import type { AudioError, WlError } from './types'

const CODES: readonly (AudioError['code'] | WlError['code'])[] = [
  'notRunning',
  'alreadyRunning',
  'noDevice',
  'deviceNotFound',
  'unsupportedFormat',
  'streamFailed',
  'settings',
  'chain',
  'invalidArgument',
  'queueFull',
  'notFound',
  'parse',
  'changedMeanwhile',
  'missingEntry',
  'invalidChange',
  'closeTimeout',
  'writeFailed',
  'startFailed',
  'verifyFailed',
]

/** The stable code of an engine error, or null for anything else. */
export function errorCode(e: unknown): (AudioError['code'] | WlError['code']) | null {
  if (typeof e !== 'object' || e === null || !('code' in e)) return null
  const code = (e as { code: unknown }).code
  return CODES.find((c) => c === code) ?? null
}

/** desktop.errors.<code>, or desktop.errors.other with the detail. */
export function errorMsg(e: unknown): Msg {
  const code = errorCode(e)
  if (code) return { key: `desktop.errors.${code}` }
  const message = e instanceof Error ? e.message : typeof e === 'object' && e !== null && 'message' in e ? String((e as { message: unknown }).message) : String(e)
  return { key: 'desktop.errors.other', params: { message } }
}
