import { useCallback, useMemo, useState } from 'react'
import { emptyTrend, pushTrend, trendTone, type ToneTrend, type TrendTone } from '../../../desktop/advice/trend'
import type { HeldMetrics } from '../../../live/hold'

export interface ToneTrendState extends TrendTone {
  /** Start over (a chain was loaded). */
  reset(): void
}

interface Seen {
  held: HeldMetrics | null
  notBeforeMs: number | undefined
  style: string
  trend: ToneTrend
}

/**
 * The stable tone over the fresh live windows (desktop/advice/trend.ts): each new held window is added once,
 * notBeforeMs (the settle time after the last change) starts it over, and so does a new goal style, because the live
 * tone is measured against the style's target.
 */
export function useToneTrend(held: HeldMetrics | null, notBeforeMs: number | undefined, style: string): ToneTrendState {
  const [seen, setSeen] = useState<Seen>({ held: null, notBeforeMs, style, trend: emptyTrend(notBeforeMs) })
  let current = seen
  if (held !== seen.held || notBeforeMs !== seen.notBeforeMs || style !== seen.style) {
    // adjusting state while rendering (React "storing information from previous renders"): one push per new window
    const base = style === seen.style ? seen.trend : emptyTrend(notBeforeMs)
    current = { held, notBeforeMs, style, trend: held ? pushTrend(base, held, notBeforeMs) : base }
    setSeen(current)
  }
  const trend = current.trend
  const tone = useMemo(() => trendTone(trend), [trend])
  const reset = useCallback(() => setSeen((s) => ({ ...s, trend: emptyTrend(s.notBeforeMs) })), [])
  return { ...tone, reset }
}
