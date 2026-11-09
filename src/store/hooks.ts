// React hooks over the selectors. Safe against re-render loops: array/object results are compared
// shallowly (useShallow) or memoized on the state slices they read.
import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useBench } from './benchStore'
import {
  selectBestControl,
  selectCanGoNext,
  selectFxDist,
  selectSlots,
  selectStepTake,
  selectSuggestion,
  selectTakeA,
  selectTakeB,
  selectTakeGroups,
} from './selectors'

/** Latest take per STEPS slot for `session` (default: current session). */
export const useSlots = (session?: string) => useBench(useShallow((s) => selectSlots(s, session)))

export const useBestControl = (session?: string) => useBench(useShallow((s) => selectBestControl(s, session)))

export const useFxDist = () => useBench(selectFxDist)

export const useStepTake = () => useBench(selectStepTake)

export const useTakeA = () => useBench(selectTakeA)

export const useTakeB = () => useBench(selectTakeB)

export const useCanGoNext = () => useBench(selectCanGoNext)

export function useSuggestion() {
  const inputs = useBench(useShallow((s) => ({ takes: s.takes, session: s.session, fxDist: s.fxDist, A: s.A, goal: s.goal })))
  return useMemo(() => selectSuggestion(inputs), [inputs])
}

export function useTakeGroups() {
  const inputs = useBench(useShallow((s) => ({ takes: s.takes, session: s.session })))
  return useMemo(() => selectTakeGroups(inputs), [inputs])
}

/** The person's mic profile (stable reference until it changes). */
export const useMicProfile = () => useBench((s) => s.micProfile)

/** The voice goal (stable reference until setGoal changes it); pass it to diagnose / plain / suggest helpers. */
export const useGoal = () => useBench((s) => s.goal)
