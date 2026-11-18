import { useCallback, useState } from 'react'
import { loadTuneGoals, saveTuneGoals } from '../../../desktop/autotune/goals'
import type { TuneGoals } from '../../../desktop/tune'

export interface TuneGoalsState {
  goals: TuneGoals
  setGoals(patch: Partial<TuneGoals>): void
}

/** The last goals picked (localStorage `vcb-autotune-goals`), saved on every change. */
export function useTuneGoals(): TuneGoalsState {
  const [goals, set] = useState<TuneGoals>(loadTuneGoals)
  const setGoals = useCallback((patch: Partial<TuneGoals>) => {
    set((g) => {
      const next = { ...g, ...patch }
      saveTuneGoals(next)
      return next
    })
  }, [])
  return { goals, setGoals }
}
