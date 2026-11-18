// Msg builders for desktop.autotune.* (src/i18n/locales/{en,pt-BR}/desktop.json). Numbers travel as params; plugin
// names and plugin field labels stay English (they come from the exact change line, ../changeMsg.ts).
import { BANDS } from '../../audio/reference'
import type { Msg } from '../../plain/types'
import { BAND_KEYS } from './targets'

const msg = (key: string, params?: Msg['params']): Msg => (params ? { key: `desktop.autotune.${key}`, params } : { key: `desktop.autotune.${key}` })

/** Why a change was made: desktop.autotune.reason.<key>. */
export const reasonMsg = (key: string, params?: Msg['params']): Msg => msg(`reason.${key}`, params)

/** A goal the tuner could not reach: desktop.autotune.unmet.<key>. */
export const unmetMsg = (key: string, params?: Msg['params']): Msg => msg(`unmet.${key}`, params)

/** Tone reason of a cut (`high`: the band was too strong) or a boost (`low`) for a BANDS index (boom … air). */
export const toneReasonMsg = (band: number, side: 'high' | 'low', db: number): Msg => reasonMsg(`tone.${side}.${BAND_KEYS[band]}`, { db })

/**
 * Tone reason of a band that was moved (frequency, width) onto a BANDS index: too much of it there (`high`, the cut
 * lands on it) or too little (`low`, the lift lands on it).
 */
export const shapeReasonMsg = (band: number, side: 'high' | 'low'): Msg => reasonMsg(`tone.shape.${side}`, bandRange(band))

/**
 * The message with its `db` param (the size of the whole move) and its `to` param (the value it ends at) set, when it
 * has them: a later stage may move the same value again (a gate threshold following the make-up gain).
 */
export const withMoveDb = (m: Msg, db: number, to?: number): Msg => {
  if (!m.params || !('db' in m.params || (to !== undefined && 'to' in m.params))) return m
  return { key: m.key, params: { ...m.params, ...('db' in m.params ? { db } : {}), ...(to !== undefined && 'to' in m.params ? { to } : {}) } }
}

/** Frequency range of a BANDS index, as params. */
export const bandRange = (band: number): { lo: number; hi: number } => ({ lo: BANDS[band].lo, hi: BANDS[band].hi })
