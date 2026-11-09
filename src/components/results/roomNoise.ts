// Pure helpers for the room-noise results: band SNR checks, before/after pair.
import { sessionSlots } from '../../session/bestControl'
import { pickSuggestionBase } from '../../settings/suggest'
import { isAnalysisError, type Analysis, type NoiseKind, type Take } from '../../types'

export const NOISE_KIND_LABEL: Record<NoiseKind, string> = {
  quiet: 'Quiet room',
  hum: 'Mains hum',
  tonal: 'Fan / machine tones',
  broadband: 'Broadband noise',
}

/** Voice bands 640 Hz–5 kHz (BANDS indexes 4..6). */
const VOICE_BANDS = [4, 5, 6] as const

/** True when the take has a full set of finite per-band SNR values (absent on old data or without silence). */
export const hasBandSnr = (a: Analysis): boolean =>
  !!a.bandSnr?.length && !!a.noiseBands?.length && a.bandSnr.every(Number.isFinite) && a.noiseBands.every(Number.isFinite)

/** Mean SNR over the voice bands, NaN when unavailable. */
export const voiceBandSnr = (a: Analysis): number =>
  hasBandSnr(a) ? VOICE_BANDS.reduce((sum, i) => sum + a.bandSnr[i], 0) / VOICE_BANDS.length : Number.NaN

/** "780 Hz" / "2.4 kHz". */
/** Exact enough to tell close tones apart: 768 Hz, 1559 Hz, 3832 Hz, 12.5 kHz. */
export const fmtHz = (hz: number): string => (hz >= 10000 ? `${+(hz / 1000).toFixed(1)} kHz` : `${Math.round(hz)} Hz`)

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
