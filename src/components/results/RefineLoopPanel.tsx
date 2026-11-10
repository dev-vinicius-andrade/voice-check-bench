import type { Take } from '../../types'
import { AttemptsTimeline } from './AttemptsTimeline'
import { ChangeApproachCard, MismatchCard, WorkedCard } from './LoopCards'
import { RefineCard } from './RefineCard'
import type { RefineLoop } from './useRefineLoop'

/** Attempts timeline, then one outcome: wrong distance (first, no refinement) · it worked · change approach · let's fix this. */
export function RefineLoopPanel({ A, loop }: { A: Take; loop: RefineLoop }) {
  const { current, applied, refinement } = loop
  return (
    <div className="grid min-w-0 gap-3" data-testid="refine-loop">
      <AttemptsTimeline attempts={loop.attempts} currentId={current.id} />
      {current.mismatch && <MismatchCard recorded={current.mismatch.actual} dist={current.mismatch.expected} />}
      {!current.mismatch && current.improved && <WorkedCard A={A} raw={current.rawScore} fx={current.fxScore} />}
      {refinement?.changeApproach && <ChangeApproachCard attempts={loop.attempts.length} dist={refinement.dist} />}
      {refinement && !refinement.changeApproach && <RefineCard refinement={refinement} applied={applied} />}
    </div>
  )
}
