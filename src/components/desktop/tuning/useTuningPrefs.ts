import { useCallback, useState } from 'react'
import { loadTuningPrefs, saveTuningPrefs, type TuningPrefs } from '../../../desktop/advice/prefs'

export interface TuningPrefsState {
  prefs: TuningPrefs
  setPrefs(patch: Partial<TuningPrefs>): void
}

/** "Your sound" processing amount and noise mode, kept in localStorage ('vcb-tuning-prefs'; defaults when blocked). */
export function useTuningPrefs(): TuningPrefsState {
  const [prefs, set] = useState<TuningPrefs>(loadTuningPrefs)
  const setPrefs = useCallback(
    (patch: Partial<TuningPrefs>) =>
      set((p) => {
        const next = { ...p, ...patch }
        saveTuningPrefs(next)
        return next
      }),
    [],
  )
  return { prefs, setPrefs }
}
