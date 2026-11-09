// Anonymized summary of a session (the CommunitySummary a person copies or shares). Pure.
import { sessionSlots } from '../session/bestControl'
import { suggestionToJson, type SuggestionJson } from '../settings/suggest'
import { isAnalysisError, type Analysis, type MicProfile, type NoiseKind, type Suggestion, type Take } from '../types'
import type { CommunitySummary } from './types'

const valid = (t: Take | null | undefined): t is Take & { analysis: Analysis } => !!t && !isAnalysisError(t.analysis)

/** One decimal. Non-finite values stay NaN, which JSON.stringify writes as null. */
const r1 = (v: number): number => Math.round(v * 10) / 10
const r1s = (vs: readonly number[] | undefined): number[] => (vs ?? []).map(r1)

/** Analysis numbers that are safe to share: levels and spectra only. */
function anonAnalysis(a: Analysis): CommunitySummary['takes'][number]['analysis'] {
  return {
    speechMed: r1(a.speechMed),
    noise: r1(a.noise),
    snr: r1(a.snr),
    rel: r1s(a.rel),
    bandSnr: r1s(a.bandSnr),
    tones: (a.tones ?? []).map((t) => ({ hz: Math.round(t.hz), db: r1(t.db) })),
    // takes stored before the noisy-room mode have no noiseKind; it is written as null
    noiseKind: (a.noiseKind ?? null) as NoiseKind,
    spread: r1(a.spread),
    sibP95: r1(a.sibP95),
  }
}

/**
 * Anonymized summary of A's session: mic profile, per-take analysis numbers (latest take per step of a guided
 * session, or A alone for a free take) and the suggestion values. No audio, device names, take names, dates or ids.
 */
export function anonymizedSummary(takes: readonly Take[], A: Take, mic: MicProfile, s: Suggestion | null): CommunitySummary {
  const picked = A.session === 'free' ? [A] : sessionSlots(takes, A.session)
  const rows = picked.filter(valid).map((t) => ({ step: t.step, analysis: anonAnalysis(t.analysis) }))
  // the base take's name can carry a device label, so basedOn is left out
  let suggestion: CommunitySummary['suggestion'] = null
  if (s) {
    const json: Partial<SuggestionJson> = suggestionToJson(s)
    delete json.basedOn
    suggestion = json as Omit<SuggestionJson, 'basedOn'>
  }
  return {
    app: 'voice-check-bench',
    version: 1,
    mic: { model: mic.model, kind: mic.kind, pattern: mic.pattern, address: mic.address },
    takes: rows,
    suggestion,
  }
}
