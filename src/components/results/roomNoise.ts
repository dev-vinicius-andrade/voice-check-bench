// Pure helpers for the room-noise results: band SNR checks, before/after pair.
import { FLOOR_DB } from '../../audio/analyze'
import { overprocessedStatus } from '../../audio/diagnose'
import { bestControl, sessionSlots } from '../../session/bestControl'
import { takeDist } from '../../session/steps'
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

/**
 * True when the take's pauses are digital silence (noise at the -100 dBFS floor, or noise removal / a gate cutting
 * to silence): its SNR then says nothing about how much room noise was removed.
 */
export const fakeQuiet = (a: Analysis): boolean => a.noise <= FLOOR_DB + 0.5 || overprocessedStatus(a) !== 'good'

export interface BeforeAfter {
  raw: Take & { analysis: Analysis }
  fx: Take & { analysis: Analysis }
}

const valid = (t: Take | null | undefined): t is Take & { analysis: Analysis } => !!t && !isAnalysisError(t.analysis)

/**
 * The one raw reference of A's guided session (v0.8), used everywhere a processed take is compared: the raw control
 * at the distance the processed take was actually recorded at (a processed A's own distance, else fxDist in the current
 * session) if it exists and is analyzable, else the best control. Older sessions without a processed distance use their
 * best control's distance.
 */
export function rawReference(takes: readonly Take[], A: Take, session: string, fxDist: string | null): (Take & { analysis: Analysis }) | null {
  if (A.session === 'free') return null
  const dist = (A.step === 'fx' ? takeDist(A) : null) ?? (A.session === session ? fxDist : null)
  const raw = pickSuggestionBase(sessionSlots(takes, A.session), dist)
  return valid(raw) ? raw : null
}

/** Processed take of A's guided session vs its raw reference (see rawReference). */
export function beforeAfterPair(takes: readonly Take[], A: Take, session: string, fxDist: string | null): BeforeAfter | null {
  if (A.session === 'free') return null
  const fx = sessionSlots(takes, A.session)[3]
  const raw = valid(fx) ? rawReference(takes, fx, session, fxDist) : null
  return valid(fx) && raw ? { raw, fx } : null
}

const RAW_STEPS = new Set(['c2', 'c8', 'c15'])

/** The session's best raw control take, else A when A itself is a raw control (community comparisons). */
export function yourRawAnalysis(takes: readonly Take[], A: Take): Analysis | null {
  const best = A.session === 'free' ? null : bestControl(sessionSlots(takes, A.session))?.take
  const t = best ?? (A.step && RAW_STEPS.has(A.step) ? A : null)
  return t && !isAnalysisError(t.analysis) ? t.analysis : null
}
