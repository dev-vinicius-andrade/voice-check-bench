// Text helpers for the Community page list.
import type { CommunityMicStats } from '../../community/types'

/** "31 dB (25–36)": median raw SNR with the p25–p75 range. */
export const fmtSnr = (m: CommunityMicStats): string =>
  `${m.rawSnr.median.toFixed(0)} dB (${m.rawSnr.p25.toFixed(0)}–${m.rawSnr.p75.toFixed(0)})`

/** "8 cm (5 of 9)" or "—". */
export const fmtDistance = (m: CommunityMicStats): string => {
  const top = m.bestDistance[0]
  return top ? `${top.dist} (${top.votes} of ${m.reports})` : '—'
}

/** "40 %". */
export const fmtNoisyShare = (m: CommunityMicStats): string => `${Math.round(m.noisyRoomShare * 100)} %`

/** Mics matching the search (case-insensitive substring of the model), most reports first. */
export function filterMics(mics: readonly CommunityMicStats[], query: string): CommunityMicStats[] {
  const q = query.trim().toLowerCase()
  return mics
    .filter((m) => m.reports > 0 && (!q || m.model.toLowerCase().includes(q)))
    .sort((a, b) => b.reports - a.reports || a.model.localeCompare(b.model))
}

/** Localized date of the index build, or null for a missing/placeholder timestamp. */
export function fmtGenerated(generated: string): string | null {
  const d = new Date(generated)
  if (Number.isNaN(d.getTime()) || d.getTime() <= 0) return null
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}
