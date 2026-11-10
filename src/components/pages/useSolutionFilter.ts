// Filter state of the "Shared settings" section, remembered in localStorage (fails soft when storage is blocked).
import { useMemo, useState } from 'react'
import {
  collectSolutions,
  DEFAULT_SOLUTION_FILTER,
  effectiveMic,
  filterSolutions,
  micsWithSolutions,
  parseSolutionFilter,
  type SolutionFilter,
  type SolutionItem,
} from '../../community/solutions'
import { micKey, type CommunityMicStats } from '../../community/types'
import { useMicProfile } from '../../store/hooks'

export const SOLUTION_FILTER_KEY = 'vcb-community-filter'

function loadFilter(): SolutionFilter {
  try {
    const raw = localStorage.getItem(SOLUTION_FILTER_KEY)
    return raw ? parseSolutionFilter(JSON.parse(raw)) : DEFAULT_SOLUTION_FILTER
  } catch {
    return DEFAULT_SOLUTION_FILTER
  }
}

function saveFilter(f: SolutionFilter): void {
  try {
    localStorage.setItem(SOLUTION_FILTER_KEY, JSON.stringify(f))
  } catch {
    // storage blocked: the choice lasts for this visit only
  }
}

export interface SolutionFilterState {
  /** The filter in effect (mic resolved to a micKey or 'all'). */
  filter: SolutionFilter & { mic: string }
  set(patch: Partial<SolutionFilter>): void
  /** Mic all, any style, any room; keeps the sort. */
  clear(): void
  micOptions: { key: string; model: string }[]
  /** Every solution in the index (0 = nothing shared yet). */
  total: number
  items: SolutionItem[]
}

export function useSolutionFilter(mics: readonly CommunityMicStats[]): SolutionFilterState {
  const own = micKey(useMicProfile().model)
  const [stored, setStored] = useState(loadFilter)
  const all = useMemo(() => collectSolutions(mics), [mics])
  const micOptions = useMemo(() => micsWithSolutions(mics), [mics])
  const mic = effectiveMic(stored.mic, own, micOptions.map((m) => m.key))
  const filter = useMemo(() => ({ ...stored, mic }), [stored, mic])
  const items = useMemo(() => filterSolutions(all, filter), [all, filter])
  const update = (next: SolutionFilter): void => {
    setStored(next)
    saveFilter(next)
  }
  return {
    filter,
    // an unchosen mic stays unchosen (follows the person's own mic) until they pick one
    set: (patch) => update({ ...stored, ...patch }),
    clear: () => update({ ...DEFAULT_SOLUTION_FILTER, mic: 'all', sort: filter.sort }),
    micOptions,
    total: all.length,
    items,
  }
}
