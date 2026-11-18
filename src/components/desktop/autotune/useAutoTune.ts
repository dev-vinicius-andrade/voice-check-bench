import { useCallback, useState } from 'react'
import type { Msg } from '../../../plain/types'
import { useBridge } from '../bridgeContext'
import { useAudioDevices } from '../tuning/useAudioDevices'
import { useManualEq } from './useManualEq'
import { useNoiseCut } from './useNoiseCut'
import { useTakeRecorder } from './useTakeRecorder'
import { useTuneGoals } from './useTuneGoals'
import { useTuneRun, type OpenTuneSession } from './useTuneRun'
import { useTuneSave } from './useTuneSave'

export type AutoTuneStep = 'record' | 'goals' | 'tune'

/**
 * The four steps of "Tune from a recording": record → goals → tuning → listen and save (the last two share 'tune').
 * Hand edits of the result survive Adjust and go with Save; a new take clears them, and a noise cut with them.
 */
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
  const tuned = run.state.step === 'done' ? run.state.result : null
  // hand changes to the ReaEQ on the result step; `result` is what that step shows and plays
  const manual = useManualEq(take, run.chain, tuned, run.render)
  const result = manual.result
  const save = useTuneSave(bridge, run, tuned, manual.edits)
  // "Cut the noise": ReaFIR's state and the cut's hand edits, then the take tuned again (SPEC "Cut the noise")
  const noise = useNoiseCut(take, run, manual, save.entries, save.reset)

  const startTuning = (): void => {
    if (!take) return
    setStep('tune')
    save.reset()
    void run.run(take, goals.goals)
  }
  const cancel = (): void => {
    // the session closes: a ReaFIR state loaded into it goes with it
    noise.reset()
    run.cancel()
    setStep('goals')
  }
  const recordAgain = (): void => {
    noise.reset()
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
  return { index, step, take, devices, deviceError, recorder, goals, run, result, manual, save, noise, startTuning, cancel, recordAgain, adjust, back: () => setStep('record') }
}

export type AutoTune = ReturnType<typeof useAutoTune>
