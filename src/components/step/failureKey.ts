// Message key for a take that could not be analysed. Same thresholds and order as failureHint() in
// src/audio/quickStats.ts (which returns English text); keep the two in step.
import type { QuickStats } from '../../audio/quickStats'

export type FailureId = 'silent' | 'tooQuiet' | 'noisyPause' | 'tooShort'
export const FAILURE_IDS: readonly FailureId[] = ['silent', 'tooQuiet', 'noisyPause', 'tooShort']

export function failureId(q: QuickStats): FailureId {
  if (!Number.isFinite(q.peakDb) || q.peakDb < -90) return 'silent'
  if (q.readingDb < -55) return 'tooQuiet'
  if (q.readingDb - q.silenceDb < 15) return 'noisyPause'
  return 'tooShort'
}

export const failureKey = (q: QuickStats): string => `wizard.take.failure.${failureId(q)}`
