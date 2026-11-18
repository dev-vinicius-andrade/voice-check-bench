import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMsg } from '../../../desktop/errors'
import { retune, tune, type Bother, type TuneGoals, type TuneResult, type TuneStage } from '../../../desktop/tune'
import type { TuneBridge, TuneSession } from '../../../desktop/tune/renderer'
import type { ChainSlot, Change, ValueChange } from '../../../desktop/advice/types'
import type { WlChainChange, WlSnapshot } from '../../../desktop/types'
import type { Msg } from '../../../plain/types'

export type OpenTuneSession = (bridge: TuneBridge, take: Float32Array) => Promise<TuneSession>

export type TuneRunState =
  | { step: 'idle' }
  /** `stage` is null until the first render; `passes` counts the renders of each stage so far. */
  | { step: 'running'; stage: TuneStage | null; passes: Partial<Record<TuneStage, number>> }
  | { step: 'done'; result: TuneResult }
  | { step: 'error'; msg: Msg }

export interface TuneRun {
  state: TuneRunState
  /** The Settings.json read right before the session opened (Save's hash and entries). */
  snapshot: WlSnapshot | null
  /** The open session's baseline chain (null until a session opened, and after cancel). */
  chain: ChainSlot[] | null
  /** Wave Link changes for these changes (a result's, hand edits included), from the open session (rejects when none is open). */
  exportChanges(changes: readonly (Change & { also?: readonly ValueChange[] })[]): Promise<WlChainChange[]>
  /** Renders the take with `changes` on top of the baseline through the open session (rejects when none is open). */
  render(changes: readonly Change[]): Promise<Float32Array>
  run(take: Float32Array, goals: TuneGoals): Promise<void>
  /** Tune again from the current result with what the person said. */
  adjust(feedback: readonly Bother[] | 'tooProcessed'): Promise<void>
  /**
   * Tune the same take again from the untouched chain with the current result's goals and limit (after a plugin
   * state was loaded or restored: "Cut the noise"). Nothing when there is no result.
   */
  rerun(): Promise<void>
  /** Loads a plugin state into a slot of the open session for every later render; null puts its own back (rejects when none is open). */
  setState(slot: number, parameterState: string | null): Promise<void>
  /** Stop waiting for the run and close the session. */
  cancel(): void
}

/** One render session per take: opens it, runs tune() / retune() with progress, closes it on cancel, new take or unmount. */
export function useTuneRun(bridge: TuneBridge, open: OpenTuneSession): TuneRun {
  const [state, setState] = useState<TuneRunState>({ step: 'idle' })
  const [snapshot, setSnapshot] = useState<WlSnapshot | null>(null)
  const [chain, setChain] = useState<ChainSlot[] | null>(null)
  const session = useRef<{ take: Float32Array; s: TuneSession } | null>(null)
  const runId = useRef(0)
  const take = useRef<Float32Array | null>(null)
  // plugin states loaded or restored in the session so far, and how many there were when the shown result's job
  // started: a result from before the last one rendered other audio, so its render is no start for the next run
  const states = useRef(0)
  const resultStates = useRef(0)

  const closeSession = useCallback(() => {
    session.current?.s.close().catch(() => undefined)
    session.current = null
  }, [])
  useEffect(() => () => {
    runId.current++
    closeSession()
  }, [closeSession])

  /** Runs `job` on the take's session (opened first when needed) unless cancelled meanwhile. */
  const go = useCallback(
    async (t: Float32Array, job: (s: TuneSession, progress: (stage: TuneStage) => void) => Promise<TuneResult>): Promise<void> => {
      const id = ++runId.current
      take.current = t
      setState({ step: 'running', stage: null, passes: {} })
      const progress = (stage: TuneStage): void => {
        if (id !== runId.current) return
        setState((s) => (s.step === 'running' ? { step: 'running', stage, passes: { ...s.passes, [stage]: (s.passes[stage] ?? 0) + 1 } } : s))
      }
      try {
        if (session.current?.take !== t) {
          closeSession()
          // read first: the hash Save checks is then never newer than the chain the session opens
          const snap = await bridge.wavelinkRead()
          const s = await open(bridge, t)
          if (id !== runId.current) {
            s.close().catch(() => undefined)
            return
          }
          setSnapshot(snap)
          setChain(s.chain)
          session.current = { take: t, s }
        }
        const current = session.current
        if (!current) return
        const at = states.current
        const result = await job(current.s, progress)
        if (id !== runId.current) return
        resultStates.current = at
        setState({ step: 'done', result })
      } catch (e) {
        if (id === runId.current) setState({ step: 'error', msg: errorMsg(e) })
      }
    },
    [bridge, closeSession, open],
  )

  const run = (t: Float32Array, goals: TuneGoals): Promise<void> =>
    go(t, (s, onStage) => tune({ take: t, goals, chain: s.chain, render: s.render, onProgress: onStage }))

  const adjust = async (feedback: readonly Bother[] | 'tooProcessed'): Promise<void> => {
    const t = take.current
    if (state.step !== 'done' || !t) return
    const { startRender, ...rest } = retune(state.result, feedback)
    const next = resultStates.current === states.current ? { ...rest, startRender } : rest
    return go(t, (s, onStage) => tune({ take: t, chain: s.chain, render: s.render, ...next, onProgress: onStage }))
  }

  const rerun = async (): Promise<void> => {
    const t = take.current
    if (state.step !== 'done' || !t) return
    const { goals, limit } = state.result
    return go(t, (s, onStage) => tune({ take: t, goals, limit, chain: s.chain, render: s.render, onProgress: onStage }))
  }

  const loadState: TuneRun['setState'] = async (slot, parameterState) => {
    const current = session.current
    if (!current) throw new Error('no tune session')
    // counted before it lands: a load that fails half way leaves the plugin in a state no result was rendered with
    states.current++
    await current.s.setState(slot, parameterState)
  }

  const cancel = (): void => {
    runId.current++
    closeSession()
    setChain(null)
    setState({ step: 'idle' })
  }

  const exportChanges: TuneRun['exportChanges'] = (changes) =>
    session.current ? session.current.s.exportChanges(changes) : Promise.reject(new Error('no tune session'))
  const render: TuneRun['render'] = (changes) => (session.current ? session.current.s.render(changes) : Promise.reject(new Error('no tune session')))

  return { state, snapshot, chain, exportChanges, render, run, adjust, rerun, setState: loadState, cancel }
}
