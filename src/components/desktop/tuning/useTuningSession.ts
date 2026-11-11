import { useMemo, useState } from 'react'
import { advise, adviceNotBefore } from '../../../desktop/advice/advise'
import type { Advice } from '../../../desktop/advice/types'
import { errorMsg } from '../../../desktop/errors'
import type { WlSnapshot } from '../../../desktop/types'
import type { Msg } from '../../../plain/types'
import { useBench } from '../../../store/benchStore'
import { useBridge } from '../bridgeContext'
import { useAdviceFeedback } from './useAdviceFeedback'
import { useAudioDevices } from './useAudioDevices'
import { useChainState } from './useChainState'
import { useLiveEngine } from './useLiveEngine'
import { useRestoreFlow } from './useRestoreFlow'
import { useSaveFlow } from './useSaveFlow'
import { useToneTrend } from './useToneTrend'
import { useTuningPrefs } from './useTuningPrefs'

/** Same advice, same target value. */
const sig = (a: Advice): string => (a.kind === 'value' ? `${a.id}=${a.to}` : `${a.id}=${a.on}`)

/** Everything the live tuning screen shows and does. */
export function useTuningSession() {
  const bridge = useBridge()
  const [error, setError] = useState<Msg | null>(null)
  /** Why Settings.json could not be read at Start (saving is off then). */
  const [fileError, setFileError] = useState<Msg | null>(null)
  const devices = useAudioDevices(bridge, setError)
  const engine = useLiveEngine(bridge, setError)
  const chain = useChainState(bridge, engine.markChange, engine.nowMs)
  const goal = useBench((s) => s.goal)
  const save = useSaveFlow(bridge, chain.model, chain.saved)
  const restore = useRestoreFlow(bridge)
  const prefs = useTuningPrefs()
  const feedback = useAdviceFeedback(chain, engine.nowMs)
  const held = engine.update?.held ?? null
  const notBeforeMs = adviceNotBefore(chain.lastChangeMs)
  const trend = useToneTrend(held, notBeforeMs, goal.style)

  const start = async (): Promise<void> => {
    const status = await engine.start(devices.inputId, devices.outputId)
    if (!status) return
    let snap: WlSnapshot | null = null
    try {
      snap = await bridge.wavelinkRead()
      setFileError(null)
    } catch (e) {
      setFileError(errorMsg(e))
    }
    trend.reset()
    feedback.reset()
    chain.load(status, snap)
  }

  const live = chain.model?.undo.chain ?? null
  const { applied } = chain
  const { tone, evidenceSec } = trend
  const { blocked } = feedback
  const advice = useMemo((): Advice[] => {
    if (!held || !live) return []
    const done = new Set(applied.map((a) => sig(a.advice)))
    const opts = { notBeforeMs, prefs: prefs.prefs, tone, evidenceSec, blocked }
    return advise(held, live, goal, opts).filter((a) => !done.has(sig(a)))
  }, [held, live, goal, applied, notBeforeMs, prefs.prefs, tone, evidenceSec, blocked])

  return { error, setError, fileError, devices, engine, chain, goal, prefs, feedback, advice, save, restore, start }
}

export type TuningSession = ReturnType<typeof useTuningSession>
