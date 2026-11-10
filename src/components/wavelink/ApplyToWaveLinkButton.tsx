import { useCallback, useState } from 'react'
import Button, { type ButtonProps } from '@mui/material/Button'
import { useTranslation } from 'react-i18next'
import { useBench } from '../../store/benchStore'
import type { Suggestion } from '../../types'
import type { WlApplyPlan, WlFile } from '../../wavelink/types'
import { offEffects } from '../guide/waveLinkSteps'
import { useNrChoice } from '../guide/nrChoice'
import { WaveLinkApplyDialog } from './WaveLinkApplyDialog'
import { appliedFromPlan, suggestionPlan } from './wlPlan'

/** "Apply to Wave Link" for the current suggestion (results and guide). */
export function ApplyToWaveLinkButton({ s, variant = 'contained', size = 'small' }: { s: Suggestion } & Pick<ButtonProps, 'variant' | 'size'>) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [choice] = useNrChoice()
  const buildPlan = useCallback((_file: WlFile, key: string) => suggestionPlan(s, key, offEffects(s, choice)), [s, choice])
  const onApplied = (plan: WlApplyPlan): void => {
    const applied = appliedFromPlan(plan, s.dist, choice)
    if (applied) useBench.getState().markApplied(applied)
  }
  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)}>{t('profiles.wl.entry')}</Button>
      <WaveLinkApplyDialog open={open} onClose={() => setOpen(false)} buildPlan={buildPlan} onApplied={onApplied} />
    </>
  )
}
