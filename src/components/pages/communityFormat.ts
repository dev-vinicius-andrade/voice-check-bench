// Text helpers for the Community page list (locale-aware via src/i18n/format).
import i18n from '../../i18n'
import { fmtDate, fmtDb, fmtNum } from '../../i18n/format'
import type { CommunityMicStats } from '../../community/types'

/** "31 dB (25–36)": median raw SNR with the p25–p75 range. */
export const fmtSnr = (m: CommunityMicStats): string =>
  `${fmtDb(m.rawSnr.median, 0, false)} (${fmtNum(m.rawSnr.p25, 0)}–${fmtNum(m.rawSnr.p75, 0)})`

/** "8 cm (5 of 9)" or "—". */
export const fmtDistance = (m: CommunityMicStats): string => {
  const top = m.bestDistance[0]
  return top
    ? i18n.t('pages.community.votes', { dist: top.dist, votes: fmtNum(top.votes, 0), reports: fmtNum(m.reports, 0) })
    : '—'
}

/** "40 %". */
export const fmtNoisyShare = (m: CommunityMicStats): string => `${fmtNum(Math.round(m.noisyRoomShare * 100), 0)} %`

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
  return fmtDate(d)
}
