// Choices of the mic profile card. Labels and explanations live in wizard.json under wizard.mic.*;
// the tips come from src/mics/catalog.ts (addressTip / placementTip).
import type { MicAddress, MicKind, MicPattern } from '../../types'

export const KINDS: readonly MicKind[] = ['dynamic', 'condenser', 'unknown']
export const PATTERNS: readonly MicPattern[] = ['cardioid', 'supercardioid', 'omni', 'figure8', 'unknown']
export const ADDRESSES: readonly MicAddress[] = ['end', 'side', 'unknown']
