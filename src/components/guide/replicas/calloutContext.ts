// Callouts of the replica being rendered, read by <Spot> next to each control.
import { createContext, useContext } from 'react'
import type { Callout } from './types'

export const CalloutContext = createContext<readonly Callout[]>([])

/** Number of the callout pointing at target, or undefined (unknown targets are ignored). */
export const calloutNumber = (callouts: readonly Callout[], target: string): number | undefined =>
  callouts.find((c) => c.target === target)?.n

export const useCalloutNumber = (target: string | undefined): number | undefined => {
  const callouts = useContext(CalloutContext)
  return target ? calloutNumber(callouts, target) : undefined
}
