import { useCallback, useEffect, useRef, useState } from 'react'
import type { DesktopBridge } from '../../../desktop/bridge'
import { errorMsg } from '../../../desktop/errors'
import { DesktopLiveFeed } from '../../../desktop/liveFeed'
import type { AudioFrame, AudioMonitor, AudioStatus } from '../../../desktop/types'
import type { LiveUpdate } from '../../../live/tracker'
import type { Msg } from '../../../plain/types'
import { useBench } from '../../../store/benchStore'

export type EngineState = 'idle' | 'starting' | 'running'

export interface LiveEngine {
  state: EngineState
  /** audio_start result while running (monitor follows audio_set_monitor). */
  status: AudioStatus | null
  /** Newest analysis update (held metrics, history, segments); null until the first one. */
  update: LiveUpdate | null
  /** Chain latency in samples (raw is delayed by it). */
  latencySamples: number
  start(inputId: string, outputId: string): Promise<AudioStatus | null>
  stop(): Promise<void>
  setMonitor(m: AudioMonitor): Promise<void>
  /** A setting changed now: segment + history marker. */
  markChange(label: Msg): void
  /** The stream clock, ms since Start. */
  nowMs(): number
}

/** Start/stop of the audio engine and the live analysis of its stream. Stops the engine on unmount. */
export function useLiveEngine(bridge: DesktopBridge, setError: (m: Msg | null) => void): LiveEngine {
  const [feed] = useState(() => new DesktopLiveFeed())
  const [state, setState] = useState<EngineState>('idle')
  const [status, setStatus] = useState<AudioStatus | null>(null)
  const [update, setUpdate] = useState<LiveUpdate | null>(null)
  const [latencySamples, setLatency] = useState(0)
  const running = useRef(false)

  useEffect(
    () => () => {
      if (running.current) bridge.audioStop().catch(() => undefined)
      running.current = false
    },
    [bridge],
  )

  const onFrame = useCallback(
    (f: AudioFrame) => {
      if (!running.current) return
      setLatency(f.latencySamples)
      const u = feed.push(f, useBench.getState().goal)
      if (u) setUpdate(u)
    },
    [feed],
  )

  const start = useCallback(
    async (inputId: string, outputId: string): Promise<AudioStatus | null> => {
      setState('starting')
      setError(null)
      setUpdate(null)
      feed.reset()
      running.current = true
      try {
        const s = await bridge.audioStart({ inputId: inputId || undefined, outputId: outputId || undefined }, onFrame)
        setStatus(s)
        setLatency(s.latency.alignedSamples)
        setState('running')
        return s
      } catch (e) {
        running.current = false
        setError(errorMsg(e))
        setState('idle')
        return null
      }
    },
    [bridge, feed, onFrame, setError],
  )

  const stop = useCallback(async (): Promise<void> => {
    running.current = false
    try {
      await bridge.audioStop()
    } catch (e) {
      setError(errorMsg(e))
    }
    setState('idle')
    setStatus(null)
  }, [bridge, setError])

  const setMonitor = useCallback(
    async (monitor: AudioMonitor): Promise<void> => {
      try {
        await bridge.audioSetMonitor(monitor)
        setStatus((s) => (s ? { ...s, monitor } : s))
      } catch (e) {
        setError(errorMsg(e))
      }
    },
    [bridge, setError],
  )

  const markChange = useCallback((label: Msg) => feed.markChange(label), [feed])
  const nowMs = useCallback(() => feed.nowMs, [feed])

  return { state, status, update, latencySamples, start, stop, setMonitor, markChange, nowMs }
}
