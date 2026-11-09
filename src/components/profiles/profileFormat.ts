// On-screen labels of a profile: validation chip, host, style, mic, distance, export file name.
import type { TFunction } from 'i18next'
import { fmtDate } from '../../i18n/format'
import type { Profile } from '../../profiles/types'

export function validationLabel(t: TFunction, p: Profile): string {
  const v = p.validation
  if (!v) return t('profiles.card.notValidated')
  return t('profiles.card.validated', { raw: Math.round(v.rawScore), fx: Math.round(v.fxScore), date: fmtDate(v.date) })
}

export const hostLabel = (t: TFunction, p: Profile): string =>
  p.host ? t(`guide.host.option.${p.host}.name`) : t('profiles.host.none')

export const styleLabel = (t: TFunction, p: Profile): string => t(`wizard.goal.style.${p.goal.style}.name`)

export const micLabel = (t: TFunction, p: Profile): string => p.mic.model || t('profiles.card.otherMic')

/** `voice-check-profile-<name>.json` with a file-safe name. */
export function exportFileName(name: string): string {
  const safe = name.trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').toLowerCase()
  return `voice-check-profile-${safe || 'profile'}.json`
}

export const hasCapturedStates = (p: Profile): boolean => Object.keys(p.wavelinkStates ?? {}).length > 0
