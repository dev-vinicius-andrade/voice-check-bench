import { useCallback, useEffect, useRef, useState } from 'react'
import { onManualUpdateCheck, UPDATE_RECHECK_MS } from '../../desktop/updater'
import type { AvailableUpdate, CheckForUpdate, UpdateProgress } from '../../desktop/updater'

export type UpdateNoticeState =
  | { phase: 'idle' }
  | { phase: 'available'; update: AvailableUpdate }
  | { phase: 'installing'; update: AvailableUpdate; progress: UpdateProgress | null }
  | { phase: 'failed'; update: AvailableUpdate }

/**
 * Checks `delayMs` after mount, then every `recheckMs` while the app stays open, and whenever "check for updates" is
 * pressed. Offers the update, installs it with progress, or lets it wait: after Later only a manual check offers it again.
 */
export function useUpdateNotice(check: CheckForUpdate, delayMs: number, recheckMs: number = UPDATE_RECHECK_MS) {
  const [state, setState] = useState<UpdateNoticeState>({ phase: 'idle' })
  const offered = useRef(false) // an update is on screen
  const snoozed = useRef(false) // Later was pressed: no automatic offer until next start
  const alive = useRef(true)

  const look = useCallback(async (): Promise<boolean> => {
    if (offered.current) return true
    const update = await check()
    if (!update) return false
    if (!alive.current || offered.current) {
      void update.dismiss()
      return offered.current
    }
    offered.current = true
    setState({ phase: 'available', update })
    return true
  }, [check])

  useEffect(() => {
    alive.current = true
    const auto = () => {
      if (!snoozed.current) void look()
    }
    let every: ReturnType<typeof setInterval> | undefined
    const first = setTimeout(() => {
      auto()
      every = setInterval(auto, recheckMs)
    }, delayMs)
    const off = onManualUpdateCheck(look)
    return () => {
      alive.current = false
      clearTimeout(first)
      if (every) clearInterval(every)
      off()
    }
  }, [look, delayMs, recheckMs])

  const install = useCallback(() => {
    if (state.phase !== 'available' && state.phase !== 'failed') return
    const { update } = state
    setState({ phase: 'installing', update, progress: null })
    void update
      .install((progress) => setState({ phase: 'installing', update, progress }))
      .then((ok) => {
        // On success the app relaunches; staying here means a step failed.
        if (!ok) setState({ phase: 'failed', update })
      })
  }, [state])

  const later = useCallback(() => {
    if (state.phase === 'available' || state.phase === 'failed') void state.update.dismiss()
    offered.current = false
    snoozed.current = true
    setState({ phase: 'idle' })
  }, [state])

  return { state, install, later }
}
