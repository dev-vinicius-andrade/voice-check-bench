import { useRef } from 'react'
import type { Analysis, Take } from '../../types'
import { GoalLine } from './GoalLine'
import { NextActions } from './NextActions'
import { PlainSummaries } from './PlainSummaries'
import { SaveProfile } from '../profiles/SaveProfile'
import { RatingCards } from './RatingCards'
import { ScoreHero } from './ScoreHero'
import { TechnicalDetails } from './TechnicalDetails'
import { useDetailsOpen } from './useDetailsOpen'
import { usePlainResults } from './usePlainResults'

/** Id of the suggested-settings section inside the technical details. */
const SETTINGS_ID = 'suggested-settings'

const scrollToSettings = (): void =>
  document.getElementById(SETTINGS_ID)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })

/** Plain-first results for take A: score → ratings → next actions → summaries → collapsed technical details. */
export function PlainResults({ A, a }: { A: Take; a: Analysis }) {
  const { score, ratings, actions, ctx, before } = usePlainResults(A, a)
  const [open, setOpen] = useDetailsOpen()
  const pendingScroll = useRef(false)

  const showSettings = (): void => {
    if (open) {
      scrollToSettings()
      return
    }
    pendingScroll.current = true
    setOpen(true)
  }
  const onEntered = (): void => {
    if (!pendingScroll.current) return
    pendingScroll.current = false
    scrollToSettings()
  }

  return (
    <div className="grid min-w-0 gap-4">
      <GoalLine analysis={a} />
      <ScoreHero score={score} before={before} />
      <RatingCards ratings={ratings} />
      <NextActions actions={actions} ctx={ctx} onShowSettings={showSettings} />
      <PlainSummaries A={A} />
      <SaveProfile A={A} />
      <TechnicalDetails A={A} open={open} onOpenChange={setOpen} onEntered={onEntered} />
    </div>
  )
}
