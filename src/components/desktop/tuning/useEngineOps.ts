import { useCallback, useEffect, useRef } from 'react'
import type { DesktopBridge } from '../../../desktop/bridge'
import { errorMsg } from '../../../desktop/errors'
import type { EngineOp } from '../../../desktop/slots'
import { throttle, type Throttle } from '../../../desktop/throttle'
import type { AudioSlot } from '../../../desktop/types'
import type { Msg } from '../../../plain/types'

export interface EngineOps {
  /** Sends one command; the reply goes to onSlot, a failure to onError. */
  run(op: EngineOp | null): Promise<void>
  /** The throttle (≤ 20 sends per second) of one slider. */
  throttled(key: string): Throttle<EngineOp>
}

/** Engine commands of the live chain, with one throttle per slider (cancelled on unmount). */
export function useEngineOps(bridge: DesktopBridge, onSlot: (s: AudioSlot) => void, onError: (m: Msg) => void): EngineOps {
  const throttles = useRef(new Map<string, Throttle<EngineOp>>())

  useEffect(() => {
    const map = throttles.current
    return () => map.forEach((t) => t.cancel())
  }, [])

  const run = useCallback(
    async (op: EngineOp | null): Promise<void> => {
      if (!op) return
      try {
        const s =
          op.op === 'param'
            ? await bridge.audioSetParam(op.slot, op.id, op.value)
            : op.op === 'state'
              ? await bridge.audioLoadState(op.slot, op.parameterState)
              : await bridge.audioSetBypass(op.slot, op.bypassed)
        onSlot(s)
      } catch (e) {
        onError(errorMsg(e))
      }
    },
    [bridge, onSlot, onError],
  )

  const throttled = (key: string): Throttle<EngineOp> => {
    let t = throttles.current.get(key)
    if (!t) {
      t = throttle((op: EngineOp) => void run(op))
      throttles.current.set(key, t)
    }
    return t
  }

  return { run, throttled }
}
