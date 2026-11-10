import Button, { type ButtonProps } from '@mui/material/Button'
import { useTranslation } from 'react-i18next'
import { STEPS } from '../../session/steps'
import { useBench } from '../../store/benchStore'
import { stepDist } from '../step/stepCopy'

/** Index of the processed ("with your effects") step. */
const FX_STEP = STEPS.findIndex((s) => s.key === 'fx')

/** On-screen form of a distance label ("2 cm", plus inches for en-US). */
// eslint-disable-next-line react-refresh/only-export-components -- tiny formatter shared by the loop cards
export const distLabel = (dist: string): string => stepDist({ cm: null }, dist)

/** "Record again with effects": the processed step at the distance the settings were made for. */
export function RecordAgainButton({ dist, label, variant = 'outlined' }: { dist: string; label?: string } & Pick<ButtonProps, 'variant'>) {
  const { t } = useTranslation()
  const go = (): void => {
    const st = useBench.getState()
    st.setFxDist(dist)
    st.goTo('step', FX_STEP)
  }
  return <Button size="small" variant={variant} onClick={go}>{label ?? t('results.refine.recordAgain')}</Button>
}
