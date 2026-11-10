// One live session per screen visit: start/stop, latest metrics, status and error. Stops on unmount (leaving the screen).
import { useCallback, useEffect, useRef, useState } from 'react'
import { LiveStartError, type LiveConfig, type LiveError, type LiveMetrics, type LiveSessionApi, type LiveStatus } from '../../live/types'
import { useBench } from '../../store/benchStore'
import type { VoiceGoal } from '../../types'

export type LiveSessionFactory = (getGoal: () => VoiceGoal) => LiveSessionApi

export interface LiveSessionState {
  status: LiveStatus
  error: LiveError | null
  /** Latest metrics while running; null before the first update. */
  metrics: LiveMetrics | null
  start(cfg: LiveConfig): Promise<void>
  stop(): void
}

const codeOf = (e: unknown): LiveError => (e instanceof LiveStartError ? e.code : 'other')

export function useLiveSession(create: LiveSessionFactory): LiveSessionState {
  const [session] = useState(() => create(() => useBench.getState().goal))
  const [status, setStatus] = useState<LiveStatus>('idle')
  const [error, setError] = useState<LiveError | null>(null)
  const [metrics, setMetrics] = useState<LiveMetrics | null>(null)
  const mounted = useRef(true)
  /** Bumped by every start/stop so a slow start that was overtaken does not flip the state back. */
  const run = useRef(0)

  useEffect(() => {
    mounted.current = true
    const off = session.subscribe((m) => {
      if (mounted.current) setMetrics(m)
    })
    return () => {
      mounted.current = false
      off()
      session.stop()
    }
  }, [session])

  const start = useCallback(
    async (cfg: LiveConfig): Promise<void> => {
      const id = ++run.current
      setStatus('starting')
      setError(null)
      setMetrics(null)
      try {
        await session.start(cfg)
        if (!mounted.current) {
          session.stop()
          return
        }
        if (id === run.current) setStatus('running')
      } catch (e) {
        session.stop()
        if (!mounted.current || id !== run.current) return
        setError(codeOf(e))
        setStatus('error')
      }
    },
    [session],
  )

  const stop = useCallback((): void => {
    run.current++
    session.stop()
    setStatus('idle')
    setMetrics(null)
  }, [session])

  return { status, error, metrics, start, stop }
}
