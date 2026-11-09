// Which noise remover the person picked in the Wave Link path when AI noise removal is suggested first
// (suggestion.noiseReduction.preferAi). Saved in localStorage 'vcb-nr-choice' (fails soft when storage is blocked).
import { useCallback, useState } from 'react'
import { readPref, writePref } from '../../storage/prefs'

export type NrChoice = 'ai-elgato' | 'ai-nvidia' | 'reafir'

export const NR_CHOICES: readonly NrChoice[] = ['ai-elgato', 'ai-nvidia', 'reafir']
export const NR_CHOICE_KEY = 'vcb-nr-choice'

/** Saved choice, or null when none was made yet (or the saved value is unknown). readPref/writePref use try/catch. */
export function loadNrChoice(): NrChoice | null {
  const raw = readPref<unknown>(NR_CHOICE_KEY, null)
  return NR_CHOICES.find((c) => c === raw) ?? null
}

export function saveNrChoice(c: NrChoice): void {
  writePref(NR_CHOICE_KEY, c)
}

/** The saved choice plus a setter that persists it. */
export function useNrChoice(): [NrChoice | null, (c: NrChoice) => void] {
  const [choice, setChoice] = useState<NrChoice | null>(loadNrChoice)
  const set = useCallback((c: NrChoice) => {
    saveNrChoice(c)
    setChoice(c)
  }, [])
  return [choice, set]
}
