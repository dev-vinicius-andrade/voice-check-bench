import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Button, { type ButtonProps } from '@mui/material/Button'
import { useTranslation } from 'react-i18next'
import { useBench } from '../../store/benchStore'
import type { AppliedInput } from '../wavelink/wlPlan'

/** "I applied these settings" for people who set the values by hand: marks them applied (closed loop, v1.1). */
export function MarkAppliedButton({ applied, variant = 'outlined' }: { applied: () => AppliedInput } & Pick<ButtonProps, 'variant'>) {
  const { t } = useTranslation()
  const [done, setDone] = useState(false)
  const mark = (): void => {
    useBench.getState().markApplied(applied())
    setDone(true)
  }
  return (
    <div className="grid justify-items-start gap-2">
      <Button size="small" variant={variant} onClick={mark} disabled={done}>{t('results.refine.markApplied')}</Button>
      {done && <Alert severity="success" className="w-full">{t('results.refine.markedApplied')}</Alert>}
    </div>
  )
}
