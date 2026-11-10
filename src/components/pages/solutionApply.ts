// "Use these settings": open the guide with a community solution in place of the session's suggestion (same path as RefineCard's "by hand").
import type { CommunitySolution } from '../../community/types'
import { useBench } from '../../store/benchStore'
import type { Refinement } from '../../types'
import { useGuideOverride } from '../guide/guideOverride'

/** basedOn of community settings; RefinedBanner and overrideSuggestion recognise the prefix. */
export const communityBasedOn = (issue: number): string => `community #${issue}`

export function solutionRefinement(s: CommunitySolution): Refinement {
  return {
    settings: { ...s.suggestion, basedOn: communityBasedOn(s.issue) },
    changes: [],
    noiseRemoval: s.suggestion.noiseReduction ? 'reafir' : 'none',
    dist: s.suggestion.dist,
    changeApproach: false,
  }
}

export function applyCommunitySolution(s: CommunitySolution): void {
  const r = solutionRefinement(s)
  const st = useBench.getState()
  // the next attempt after what was last applied (1 when nothing was applied yet)
  useGuideOverride.getState().set(r, (st.applied?.attempt ?? 0) + 1)
  st.setFxDist(r.dist)
  st.goTo('guide')
}
