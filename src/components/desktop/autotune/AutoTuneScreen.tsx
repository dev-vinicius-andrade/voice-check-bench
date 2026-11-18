import Step from '@mui/material/Step'
import StepLabel from '@mui/material/StepLabel'
import Stepper from '@mui/material/Stepper'
import useMediaQuery from '@mui/material/useMediaQuery'
import type { Theme } from '@mui/material/styles'
import { useTranslation } from 'react-i18next'
import { openTuneSession } from '../../../desktop/tune/renderer'
import { GoalsStep } from './GoalsStep'
import { RecordStep } from './RecordStep'
import { ResultStep } from './ResultStep'
import { TuningStep } from './TuningStep'
import { useAutoTune } from './useAutoTune'
import type { OpenTuneSession } from './useTuneRun'

const STEPS = ['record', 'goals', 'tuning', 'result'] as const

/**
 * "Tune from a recording" (SPEC "Tune from a recording — screen"): record → what you want → tuning → listen and save,
 * one step at a time. `openSession` is the render glue (a fake in tests).
 */
export function AutoTuneScreen({ openSession = openTuneSession }: { openSession?: OpenTuneSession }) {
  const { t } = useTranslation()
  const narrow = useMediaQuery((th: Theme) => th.breakpoints.down('sm'))
  const a = useAutoTune(openSession)
  return (
    <div className="grid gap-4">
      <Stepper activeStep={a.index} alternativeLabel={!narrow} aria-label={t('desktop.autotune.ui.steps.label')}>
        {STEPS.map((s, i) => (
          <Step key={s}>
            {/* at phone width only the current step is named */}
            <StepLabel>{narrow && i !== a.index ? '' : t(`desktop.autotune.ui.steps.${s}`)}</StepLabel>
          </Step>
        ))}
      </Stepper>
      {a.step === 'record' && <RecordStep rec={a.recorder} devices={a.devices} deviceError={a.deviceError} />}
      {a.step === 'goals' && <GoalsStep goals={a.goals} onTune={a.startTuning} onBack={a.back} />}
      {a.step === 'tune' &&
        (a.result && a.take ? (
          <ResultStep take={a.take} result={a.result} manual={a.manual} save={a.save} noise={a.noise} onAdjust={(f) => void a.adjust(f)} onRecordAgain={a.recordAgain} />
        ) : (
          <TuningStep state={a.run.state} onCancel={a.cancel} onRetry={a.startTuning} onBack={a.cancel} />
        ))}
    </div>
  )
}
