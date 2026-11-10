// Refined settings shown by the guide instead of the session's suggestion (closed loop, v1.1).
// Set by the results' "I'll change them by hand" (RefineCard); in memory only, cleared from the guide's banner.
// While set, GuideScreen renders every path with overrideSuggestion(suggestion, refined.settings).
import { create } from 'zustand'
import type { SuggestionJson } from '../../settings/suggest'
import type { AppliedSettings, Refinement, Suggestion } from '../../types'
import { saveNrChoice } from './nrChoice'

export interface GuideRefined {
  settings: SuggestionJson
  noiseRemoval: AppliedSettings['noiseRemoval']
  dist: string
  /** Attempt number these settings will be when applied. */
  attempt: number
}

interface GuideOverrideStore {
  refined: GuideRefined | null
  set(r: Refinement, attempt: number): void
  clear(): void
}

export const useGuideOverride = create<GuideOverrideStore>((set) => ({
  refined: null,
  set: (r, attempt) => {
    // the Wave Link path picks the noise remover from the saved choice: make it follow the refined route
    if (r.noiseRemoval === 'ai-elgato' || r.noiseRemoval === 'ai-nvidia') saveNrChoice(r.noiseRemoval)
    set({ refined: { settings: r.settings, noiseRemoval: r.noiseRemoval, dist: r.dist, attempt } })
  },
  clear: () => set({ refined: null }),
}))

const REFINED_WHY = { key: 'guide.refined.eqWhy' }
const COMMUNITY_WHY = { key: 'guide.refined.communityEqWhy' }

/** Issue number of settings picked on the Community page (basedOn "community #<issue>"), else null. */
export function communityIssue(basedOn: string): string | null {
  return /^community #(\d+)$/.exec(basedOn)?.[1] ?? null
}

/** The suggestion with the refined values (EQ reasons kept where the band is unchanged). Pure. */
export function overrideSuggestion(s: Suggestion, r: GuideRefined): Suggestion {
  const j = r.settings
  const why = communityIssue(j.basedOn) ? COMMUNITY_WHY : REFINED_WHY
  const ai = r.noiseRemoval === 'ai-elgato' || r.noiseRemoval === 'ai-nvidia'
  const nr = s.noiseReduction ?? (j.noiseReduction || ai ? { plugin: 'ReaFIR' as const, steps: [], alternatives: [], preferAi: false } : null)
  return {
    ...s,
    dist: r.dist,
    lowcut: j.lowcut,
    gate: j.gate,
    comp: j.comp,
    deess: j.deess,
    noisyRoom: j.noisyRoom,
    chain: j.chain,
    eq: j.eq.map((e) => ({ ...e, why: s.eq.find((b) => b.type === e.type && Math.abs(b.freq - e.freq) < 1)?.why ?? why })),
    // AI routes need preferAi so the guide shows the AI step and skips ReaFIR; 'none' drops noise removal
    noiseReduction: r.noiseRemoval === 'none' ? null : nr && { ...nr, preferAi: ai },
  }
}
