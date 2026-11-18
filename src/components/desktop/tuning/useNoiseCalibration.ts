import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProcessingAmount } from '../../../desktop/advice/prefs'
import { NoiseCalibrator } from '../../../desktop/calibrate/calibrator'
import type { CalCommand, CalView } from '../../../desktop/calibrate/types'
import type { BatchOp, ChainState } from './useChainState'
import type { LiveEngine } from './useLiveEngine'

export interface NoiseCalibration {
  view: CalView
  /** The engine runs and the chain is loaded. */
  ready: boolean
  start(): void
  cancel(): void
  more(): void
  less(): void
  undo(): void
}

/** What the card shows changes: a new phase or notice, a percent of progress, a second, a dB of level, a new result. */
const sig = (v: CalView): string =>
  [v.phase, v.notice?.key, JSON.stringify(v.detail), Math.round(v.progress * 50), Math.ceil(v.leftSec), Math.round(v.rawDb), Math.round(v.processedDb), v.canMore, v.canLess].join('|')

/**
 * "Calibrate noise" on the live screen: the calibrator (src/desktop/calibrate) gets every stream frame while it runs
 * and its changes go into the live chain as entries (one per value, moved on as it steps), so Undo, the markers and
 * Save to Wave Link see them like any other change. Stops when the engine stops.
 */
export function useNoiseCalibration(engine: LiveEngine, chain: ChainState, amount: ProcessingAmount): NoiseCalibration {
  const [cal] = useState(() => new NoiseCalibrator())
  const [view, setView] = useState<CalView>(() => cal.view)
  const ids = useRef(new Map<string, string>())
  const chainRef = useRef(chain)
  const shown = useRef<{ sig: string; summary: CalView['summary'] }>({ sig: '', summary: null })
  useEffect(() => {
    chainRef.current = chain
  })

  const show = useCallback(
    (force = false) => {
      const v = cal.view
      const s = sig(v)
      if (!force && s === shown.current.sig && v.summary === shown.current.summary) return
      shown.current = { sig: s, summary: v.summary }
      setView(v)
    },
    [cal],
  )

  /** The calibrator's commands → one batch on the live chain; remembers each target's entry. */
  const send = useCallback((cmds: readonly CalCommand[]) => {
    if (!cmds.length) return
    const batch: BatchOp[] = []
    const targets: (string | null)[] = []
    for (const c of cmds) {
      const id = ids.current.get(c.target)
      if (c.kind === 'revert') {
        ids.current.delete(c.target)
        if (id === undefined) continue
        batch.push({ op: 'undo', appliedId: id })
        targets.push(null)
      } else {
        const ch = c.change
        batch.push(id !== undefined && ch.kind === 'value' ? { op: 'retarget', appliedId: id, advice: ch } : { op: 'apply', advice: ch })
        targets.push(c.target)
      }
    }
    chainRef.current.applyBatch(batch).forEach((r, k) => {
      const t = targets[k]
      if (t !== null && r !== null) ids.current.set(t, r)
    })
  }, [])

  const running = engine.state === 'running'
  const { onFrame } = engine
  useEffect(
    () =>
      onFrame((f) => {
        if (cal.view.phase === 'idle') return
        send(cal.push(f))
        show()
      }),
    [onFrame, cal, send, show],
  )

  useEffect(() => {
    if (running || cal.view.phase === 'idle') return
    cal.engineStopped()
    ids.current.clear()
    show(true)
  }, [running, cal, show])

  const act = (f: () => CalCommand[]) => () => {
    send(f())
    show(true)
  }
  const model = chain.model
  const ready = running && model !== null

  return {
    view,
    ready,
    start: () => {
      if (!ready || !model) return
      ids.current.clear()
      act(() => cal.start(model.undo.chain, amount))()
    },
    cancel: act(() => cal.cancel()),
    more: act(() => cal.more()),
    less: act(() => cal.less()),
    undo: act(() => cal.undoAll()),
  }
}
