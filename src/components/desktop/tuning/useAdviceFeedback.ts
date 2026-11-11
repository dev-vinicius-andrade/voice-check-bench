import { useCallback, useState } from 'react'
import { blockFor, SETTLE_MS } from '../../../desktop/advice/advise'
import type { Advice } from '../../../desktop/advice/types'
import type { ChainState } from './useChainState'

export type Rating = 'better' | 'same' | 'worse'

export interface PendingFeedback {
  appliedId: string
  advice: Advice
  /** Stream clock (engine.nowMs) at Apply. */
  changeMs: number
}

export interface AdviceFeedback {
  /** The latest applied advice still waiting for a rating (null once rated, undone or replaced). */
  pending: PendingFeedback | null
  /** ms of stream left before the change can be judged (changeMs + SETTLE_MS); 0 when it is time to ask. */
  leftMs: number
  /** Moves rated worse this session (blockKey), never advised again until a chain is loaded. */
  blocked: ReadonlySet<string>
  apply(a: Advice): void
  rate(r: Rating): void
  /** A chain was loaded: no pending card, no blocks. */
  reset(): void
}

/**
 * "Does it sound better?" after Apply: the latest applied advice waits SETTLE_MS of stream time (so what you hear is
 * only the new sound), then asks. Better / Same dismiss; Worse undoes the change and blocks that move.
 */
export function useAdviceFeedback(chain: ChainState, nowMs: () => number): AdviceFeedback {
  const [pending, setPending] = useState<PendingFeedback | null>(null)
  const [blocked, setBlocked] = useState<ReadonlySet<string>>(() => new Set())
  // undone from the list (or gone with a reload): no card for it any more
  const active = pending && chain.applied.some((a) => a.appliedId === pending.appliedId) ? pending : null
  const leftMs = active ? Math.max(0, active.changeMs + SETTLE_MS - nowMs()) : 0

  const apply = (a: Advice): void => {
    const appliedId = chain.applyAdvice(a)
    if (appliedId !== null) setPending({ appliedId, advice: a, changeMs: nowMs() })
  }

  const rate = (r: Rating): void => {
    if (!active) return
    if (r === 'worse') {
      chain.undoApplied(active.appliedId)
      const key = blockFor(active.advice)
      if (key !== null) setBlocked((s) => new Set([...s, key]))
    }
    setPending(null)
  }

  const reset = useCallback(() => {
    setPending(null)
    setBlocked(new Set())
  }, [])

  return { pending: active, leftMs, blocked, apply, rate, reset }
}
