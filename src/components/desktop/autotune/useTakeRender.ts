import { useCallback, useEffect, useRef, useState } from 'react'
import { allChanges, remeasured, type ManualEdit } from '../../../desktop/autotune/manualEq'
import { errorMsg } from '../../../desktop/errors'
import type { TuneResult } from '../../../desktop/tune'
import type { Msg } from '../../../plain/types'
import type { TuneRun } from './useTuneRun'

/** One render of the take: a tune result with hand edits on top. */
export interface TakeRenderJob {
  take: Float32Array
  base: TuneResult
  edits: readonly ManualEdit[]
}

export interface TakeRender {
  /** The last render of what should be heard that finished: its job and the result measured on it. */
  last: { job: TakeRenderJob; result: TuneResult } | null
  /** A render of what should be heard is running or waiting. */
  busy: boolean
  /** The last render of what should be heard failed (the previous audio stays). */
  error: Msg | null
  /** What should be heard now (null: nothing to render, e.g. no edits); a job already asked for is not asked again. */
  want(job: TakeRenderJob | null): void
}

/**
 * Renders of the take through the tune session, one at a time: while one runs, only the latest job asked for waits
 * (the ones in between are dropped), and a render that is no longer what should be heard never replaces anything.
 */
export function useTakeRender(render: TuneRun['render']): TakeRender {
  const [last, setLast] = useState<TakeRender['last']>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Msg | null>(null)
  const latest = useRef<TakeRenderJob | null>(null)
  const pending = useRef<TakeRenderJob | null>(null)
  const running = useRef(false)
  const renderNow = useRef(render)
  useEffect(() => {
    renderNow.current = render
  })

  const pump = useCallback(async (): Promise<void> => {
    if (running.current) return
    running.current = true
    try {
      for (let job = pending.current; job; job = pending.current) {
        pending.current = null
        try {
          const processed = await renderNow.current(allChanges(job.base.changes, job.edits))
          if (latest.current !== job) continue
          setLast({ job, result: remeasured(job.take, job.base, processed) })
          setError(null)
        } catch (e) {
          if (latest.current !== job) continue
          setError(errorMsg(e))
        }
        if (!pending.current) setBusy(false)
      }
    } finally {
      running.current = false
    }
  }, [])

  const want = useCallback(
    (job: TakeRenderJob | null): void => {
      const now = latest.current
      if (!job && !now) return
      if (job && now && job.take === now.take && job.base === now.base && job.edits === now.edits) return
      latest.current = job
      pending.current = job
      setBusy(job !== null)
      if (job) return void pump()
      // nothing to render: the tuner's own result is heard, a later render starts from it
      setError(null)
      setLast(null)
    },
    [pump],
  )

  return { last, busy, error, want }
}
