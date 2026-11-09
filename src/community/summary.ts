// Anonymized summary of a session (the CommunitySummary a person copies or shares). Pure.
import { sessionSlots } from '../session/bestControl'
import { suggest, suggestionToJson, type SuggestionJson } from '../settings/suggest'
import {
  DEFAULT_GOAL,
  isAnalysisError,
  type Analysis,
  type MicProfile,
  type NoiseKind,
  type Suggestion,
  type Take,
  type VoiceGoal,
} from '../types'
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

/** EQ bands that come from perceived issues (by-ear tweaks, the nasal band): they would reveal what the person hears. */
const fromPerceived = (s: Suggestion): boolean => s.eq.some((e) => e.byEar || e.why.key === 'suggestx.why.nasal')

/** The suggestion as shared: perceived issues never leave the device, so it is rebuilt from the style alone when they changed it. */
function shareable(s: Suggestion, style: VoiceGoal['style']): Suggestion | null {
  return fromPerceived(s) ? suggest(s.base, s.dist, s.base.mic, { style, perceived: [] }) : s
}

/**
 * Anonymized summary of A's session: mic profile, per-take analysis numbers (latest take per step of a guided
 * session, or A alone for a free take), the suggestion values and the goal's style (never the perceived issues).
 * No audio, device names, take names, dates or ids.
 */
export function anonymizedSummary(
  takes: readonly Take[],
  A: Take,
  mic: MicProfile,
  s: Suggestion | null,
  goal: VoiceGoal = DEFAULT_GOAL,
): CommunitySummary {
  const picked = A.session === 'free' ? [A] : sessionSlots(takes, A.session)
  const rows = picked.filter(valid).map((t) => ({ step: t.step, analysis: anonAnalysis(t.analysis) }))
  // the base take's name can carry a device label, so basedOn is left out
  let suggestion: CommunitySummary['suggestion'] = null
  const shared = s && shareable(s, goal.style)
  if (shared) {
    const json: Partial<SuggestionJson> = suggestionToJson(shared)
    delete json.basedOn
    suggestion = json as Omit<SuggestionJson, 'basedOn'>
  }
  return {
    app: 'voice-check-bench',
    version: 1,
    mic: { model: mic.model, kind: mic.kind, pattern: mic.pattern, address: mic.address },
    takes: rows,
    suggestion,
    goalStyle: goal.style,
  }
}
