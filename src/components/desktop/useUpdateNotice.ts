import { useCallback, useEffect, useState } from 'react'
import type { AvailableUpdate, CheckForUpdate, UpdateProgress } from '../../desktop/updater'

export type UpdateNoticeState =
  | { phase: 'idle' }
  | { phase: 'available'; update: AvailableUpdate }
  | { phase: 'installing'; update: AvailableUpdate; progress: UpdateProgress | null }
  | { phase: 'failed'; update: AvailableUpdate }

/** Checks once, `delayMs` after mount; offers the update, installs it with progress, or lets it wait until next start. */
export function useUpdateNotice(check: CheckForUpdate, delayMs: number) {
  const [state, setState] = useState<UpdateNoticeState>({ phase: 'idle' })

  useEffect(() => {
    let alive = true
    const timer = setTimeout(() => {
      void check().then((update) => {
        if (!update) return
        if (alive) setState({ phase: 'available', update })
        else void update.dismiss()
      })
    }, delayMs)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [check, delayMs])

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
    setState({ phase: 'idle' })
  }, [state])

  return { state, install, later }
}
