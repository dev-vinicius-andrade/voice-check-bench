import { useCallback, useState } from 'react'
import type { Msg } from '../../../plain/types'
import { useBridge } from '../bridgeContext'
import { useAudioDevices } from '../tuning/useAudioDevices'
import { useTakeRecorder } from './useTakeRecorder'
import { useTuneGoals } from './useTuneGoals'
import { useTuneRun, type OpenTuneSession } from './useTuneRun'
import { useTuneSave } from './useTuneSave'

export type AutoTuneStep = 'record' | 'goals' | 'tune'

/** The four steps of "Tune from a recording": record → goals → tuning → listen and save (the last two share 'tune'). */
export function useAutoTune(open: OpenTuneSession) {
  const bridge = useBridge()
  const [step, setStep] = useState<AutoTuneStep>('record')
  const [take, setTake] = useState<Float32Array | null>(null)
  const [deviceError, setDeviceError] = useState<Msg | null>(null)
  const devices = useAudioDevices(bridge, setDeviceError)
  const onTake = useCallback((t: Float32Array) => {
    setTake(t)
    setStep('goals')
  }, [])
  const recorder = useTakeRecorder(bridge, onTake)
  const goals = useTuneGoals()
  const run = useTuneRun(bridge, open)
  const result = run.state.step === 'done' ? run.state.result : null
  const save = useTuneSave(bridge, run, result)

  const startTuning = (): void => {
    if (!take) return
    setStep('tune')
    save.reset()
    void run.run(take, goals.goals)
  }
  const cancel = (): void => {
    run.cancel()
    setStep('goals')
  }
  const recordAgain = (): void => {
    run.cancel()
    save.reset()
    setTake(null)
    setStep('record')
  }
  const adjust: typeof run.adjust = (feedback) => {
    save.reset()
    return run.adjust(feedback)
  }

  /** 0..3 for the stepper. */
  const index = step === 'record' ? 0 : step === 'goals' ? 1 : result ? 3 : 2
  return { index, step, take, devices, deviceError, recorder, goals, run, result, save, startTuning, cancel, recordAgain, adjust, back: () => setStep('record') }
}

export type AutoTune = ReturnType<typeof useAutoTune>
