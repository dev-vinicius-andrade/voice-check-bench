// Pure helpers for the room-noise results: band SNR checks, before/after pair.
import { bestControl, sessionSlots } from '../../session/bestControl'
import { pickSuggestionBase } from '../../settings/suggest'
import { isAnalysisError, type Analysis, type Take } from '../../types'

/** Voice bands 640 Hz–5 kHz (BANDS indexes 4..6). */
const VOICE_BANDS = [4, 5, 6] as const

/** True when the take has a full set of finite per-band SNR values (absent on old data or without silence). */
export const hasBandSnr = (a: Analysis): boolean =>
  !!a.bandSnr?.length && !!a.noiseBands?.length && a.bandSnr.every(Number.isFinite) && a.noiseBands.every(Number.isFinite)

/** Mean SNR over the voice bands, NaN when unavailable. */
export const voiceBandSnr = (a: Analysis): number =>
  hasBandSnr(a) ? VOICE_BANDS.reduce((sum, i) => sum + a.bandSnr[i], 0) / VOICE_BANDS.length : Number.NaN

export interface BeforeAfter {
  raw: Take & { analysis: Analysis }
  fx: Take & { analysis: Analysis }
}

const valid = (t: Take | null | undefined): t is Take & { analysis: Analysis } => !!t && !isAnalysisError(t.analysis)

/**
 * Processed take of A's guided session vs the raw control at the processed distance (else the best control).
 * fxDist only applies to the current session; older sessions use their best control's distance.
 */
export function beforeAfterPair(takes: readonly Take[], A: Take, session: string, fxDist: string | null): BeforeAfter | null {
  if (A.session === 'free') return null
  const slots = sessionSlots(takes, A.session)
  const fx = slots[3]
  const raw = pickSuggestionBase(slots, A.session === session ? fxDist : null)
  return valid(fx) && valid(raw) ? { raw, fx } : null
}

const RAW_STEPS = new Set(['c2', 'c8', 'c15'])

/** The session's best raw control take, else A when A itself is a raw control (community comparisons). */
export function yourRawAnalysis(takes: readonly Take[], A: Take): Analysis | null {
  const best = A.session === 'free' ? null : bestControl(sessionSlots(takes, A.session))?.take
  const t = best ?? (A.step && RAW_STEPS.has(A.step) ? A : null)
  return t && !isAnalysisError(t.analysis) ? t.analysis : null
}
