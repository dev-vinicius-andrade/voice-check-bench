import Button from '@mui/material/Button'
import { useTranslation } from 'react-i18next'
import { STEPS } from '../../session/steps'
import { useBench } from '../../store/benchStore'
import { useFxDist } from '../../store/hooks'
import { stepDist } from '../step/stepCopy'
import { StepText } from './StepText'

/** Index of the processed ("with your effects") take in the wizard. */
const FX_STEP = STEPS.findIndex((s) => s.key === 'fx')

/** Last step of every path: record the processed take at the best control distance and compare before/after. */
export function TestStep() {
  const { t } = useTranslation()
  const goTo = useBench((s) => s.goTo)
  const dist = stepDist(STEPS[FX_STEP], useFxDist())
  return (
    <div className="grid gap-3">
      <StepText lead={t('guide.test.lead')} actions={[{ text: t('guide.test.a1') }, { text: t('guide.test.a2') }, { text: t('guide.test.dist', { dist }) }, { text: t('guide.test.a3') }]} />
      <div>
        <Button variant="outlined" onClick={() => goTo('step', FX_STEP)}>{t('guide.test.button')}</Button>
      </div>
    </div>
  )
}
