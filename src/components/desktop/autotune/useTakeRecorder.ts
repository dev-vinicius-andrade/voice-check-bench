import { useCallback, useEffect, useRef, useState } from 'react'
import { checkTake, type TakeProblem } from '../../../desktop/autotune/takeCheck'
import { QUIET_SEC, TakeRecorder } from '../../../desktop/autotune/recorder'
import { decodeWav, type WavProblem } from '../../../desktop/autotune/wavDecode'
import type { DesktopBridge } from '../../../desktop/bridge'
import { errorMsg } from '../../../desktop/errors'
import type { AudioFrame } from '../../../desktop/types'
import type { Msg } from '../../../plain/types'

export type RecordPhase = 'idle' | 'starting' | 'quiet' | 'talk' | 'checking'

/** Why the take cannot be used: the check's reasons, the WAV reasons, or audio lost on the way ('gap'). */
export type RecordProblem = TakeProblem | WavProblem | 'gap'

export interface TakeRecording {
  phase: RecordPhase
  /** Seconds recorded so far (the quiet lead included). */
  seconds: number
  /** Raw mic level of the latest frame, dBFS. */
  levelDb: number
  problem: RecordProblem | null
  /** The engine refused to start (no device, …). */
  error: Msg | null
  start(inputId: string): Promise<void>
  /** Stop early (the screen offers it from MIN_STOP_SEC). */
  stop(): Promise<void>
  fromFile(file: Blob): Promise<void>
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

/** The raw mic of the engine (monitor Off) into one take; checks it and hands a good one to `onTake`. */
export function useTakeRecorder(bridge: DesktopBridge, onTake: (take: Float32Array) => void): TakeRecording {
  const rec = useRef<TakeRecorder | null>(null)
  const [phase, setPhase] = useState<RecordPhase>('idle')
  const [seconds, setSeconds] = useState(0)
  const [levelDb, setLevel] = useState(-120)
  const [problem, setProblem] = useState<RecordProblem | null>(null)
  const [error, setError] = useState<Msg | null>(null)

  useEffect(
    () => () => {
      if (rec.current) bridge.audioStop().catch(() => undefined)
      rec.current = null
    },
    [bridge],
  )

  /** Check a take off the click handler, so "Checking…" shows first. */
  const accept = useCallback(
    async (take: Float32Array): Promise<void> => {
      setPhase('checking')
      await tick()
      const p = checkTake(take)
      setPhase('idle')
      if (p) setProblem(p)
      else onTake(take)
    },
    [onTake],
  )

  const finish = useCallback(
    async (gap: boolean): Promise<void> => {
      const r = rec.current
      if (!r) return
      rec.current = null
      await bridge.audioStop().catch(() => undefined)
      if (gap) {
        setPhase('idle')
        setProblem('gap')
      } else await accept(r.take())
    },
    [accept, bridge],
  )

  const onFrame = useCallback(
    (f: AudioFrame) => {
      const r = rec.current
      if (!r) return
      const res = r.push(f)
      setSeconds(r.seconds)
      setLevel(f.rawRmsDb)
      setPhase(r.seconds < QUIET_SEC ? 'quiet' : 'talk')
      if (res !== 'recording') void finish(res === 'gap')
    },
    [finish],
  )

  const start = useCallback(
    async (inputId: string): Promise<void> => {
      setProblem(null)
      setError(null)
      setSeconds(0)
      const r = new TakeRecorder()
      rec.current = r
      setPhase('starting')
      try {
        // no output needed: nothing is heard while recording
        await bridge.audioStart({ inputId: inputId || undefined, monitor: 'off' }, onFrame)
        if (rec.current === r && r.seconds === 0) setPhase('quiet')
      } catch (e) {
        if (rec.current === r) rec.current = null
        setError(errorMsg(e))
        setPhase('idle')
      }
    },
    [bridge, onFrame],
  )

  const fromFile = useCallback(
    async (file: Blob): Promise<void> => {
      setProblem(null)
      setError(null)
      const d = decodeWav(await file.arrayBuffer())
      if (!d.ok) setProblem(d.reason)
      else await accept(d.take)
    },
    [accept],
  )

  return { phase, seconds, levelDb, problem, error, start, stop: () => finish(false), fromFile }
}
