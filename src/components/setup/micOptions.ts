// Choices of the mic profile card. Labels and explanations live in wizard.json under wizard.mic.*.
import type { MicAddress, MicKind, MicPattern, MicProfile } from '../../types'

export const KINDS: readonly MicKind[] = ['dynamic', 'condenser', 'unknown']
export const PATTERNS: readonly MicPattern[] = ['cardioid', 'supercardioid', 'omni', 'figure8', 'unknown']
export const ADDRESSES: readonly MicAddress[] = ['end', 'side', 'unknown']

/** Placement tip key: which way to turn the mic against the noise (same rule as mics/catalog placementTip). */
export const placementKey = (mic: Pick<MicProfile, 'pattern'>): string =>
  `wizard.mic.tip.placement.${mic.pattern === 'cardioid' || mic.pattern === 'supercardioid' ? mic.pattern : 'other'}`

/** Where-to-speak tip key (same rule as mics/catalog addressTip). */
export const addressKey = (mic: Pick<MicProfile, 'address'>): string => `wizard.mic.tip.address.${mic.address}`
