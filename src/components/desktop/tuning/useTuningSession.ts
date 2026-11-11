import { useMemo, useState } from 'react'
import { advise } from '../../../desktop/advice/advise'
import type { Advice } from '../../../desktop/advice/types'
import { errorMsg } from '../../../desktop/errors'
import type { WlSnapshot } from '../../../desktop/types'
import type { Msg } from '../../../plain/types'
import { useBench } from '../../../store/benchStore'
import { useBridge } from '../bridgeContext'
import { useAudioDevices } from './useAudioDevices'
import { useChainState } from './useChainState'
import { useLiveEngine } from './useLiveEngine'
import { useRestoreFlow } from './useRestoreFlow'
import { useSaveFlow } from './useSaveFlow'

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
    chain.load(status, snap)
  }

  const held = engine.update?.held ?? null
  const live = chain.model?.undo.chain ?? null
  const { applied, lastChangeMs } = chain
  const advice = useMemo((): Advice[] => {
    if (!held || !live) return []
    const done = new Set(applied.map((a) => sig(a.advice)))
    return advise(held, live, goal, { notBeforeMs: lastChangeMs }).filter((a) => !done.has(sig(a)))
  }, [held, live, goal, applied, lastChangeMs])

  return { error, setError, fileError, devices, engine, chain, advice, save, restore, start }
}

export type TuningSession = ReturnType<typeof useTuningSession>
