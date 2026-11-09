/* eslint-disable @typescript-eslint/no-unused-vars */
// STUB — replaced by the store task. Signatures follow BenchSelectors in api.ts.
import type { Suggestion, Take } from '../types'
import type { BenchState } from './api'

export const selectSlots = (_s: BenchState, _session?: string): (Take | null)[] => [null, null, null, null]
export const selectBestControl = (_s: BenchState, _session?: string): { dist: string; cm: number; take: Take } | null => null
export const selectFxDist = (_s: BenchState): string => '8 cm'
export const selectStepTake = (_s: BenchState): Take | null => null
export const selectTakeA = (_s: BenchState): Take | null => null
export const selectTakeB = (_s: BenchState): Take | null => null
export const selectSuggestion = (_s: BenchState): Suggestion | null => null
export const selectTakeGroups = (_s: BenchState): { session: string; label: string; current: boolean; takes: Take[] }[] => []
export const selectCanGoNext = (_s: BenchState): boolean => false
