import { useId, useMemo, useState } from 'react'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Step from '@mui/material/Step'
import StepLabel from '@mui/material/StepLabel'
import Stepper from '@mui/material/Stepper'
import { useTranslation } from 'react-i18next'
import { applyPlan } from '../../wavelink/codec'
import type { WlApplyPlan, WlApplyResult, WlFile } from '../../wavelink/types'
import { DownloadStep } from './DownloadStep'
import { PreviewStep } from './PreviewStep'
import { UploadStep } from './UploadStep'
import { useWaveLinkFile } from './useWaveLinkFile'

const STEPS = ['upload', 'preview', 'download'] as const

export interface WaveLinkApplyDialogProps {
  open: boolean
  onClose(): void
  /** The plan for the uploaded file's chosen mic input (suggestion values and/or a profile's exact states). */
  buildPlan(file: WlFile, inputKey: string): WlApplyPlan
  /** Dialog title; defaults to "Apply to Wave Link". */
  title?: string
}

/** Upload Settings.json → preview the changes → download the adjusted file and a dated backup. */
export function WaveLinkApplyDialog({ open, onClose, buildPlan, title }: WaveLinkApplyDialogProps) {
  const { t } = useTranslation()
  const titleId = useId()
  const wl = useWaveLinkFile()
  const [step, setStep] = useState(0)
  const result = useMemo<WlApplyResult | null>(() => {
    if (!wl.file || !wl.inputKey) return null
    try {
      return applyPlan(wl.file, buildPlan(wl.file, wl.inputKey))
    } catch {
      return null
    }
  }, [wl.file, wl.inputKey, buildPlan])
  const close = (): void => {
    wl.reset()
    setStep(0)
    onClose()
  }
  const canNext = step === 0 ? result !== null : step === 1 && result !== null && result.changes.some((c) => c.kind !== 'missing')
  return (
    <Dialog open={open} onClose={close} aria-labelledby={titleId} fullWidth maxWidth="sm">
      <DialogTitle id={titleId}>{title ?? t('profiles.wl.title')}</DialogTitle>
      <DialogContent className="grid gap-4">
        <Stepper activeStep={step} alternativeLabel>
          {STEPS.map((s) => (
            <Step key={s}>
              <StepLabel>{t(`profiles.wl.steps.${s}`)}</StepLabel>
            </Step>
          ))}
        </Stepper>
        {step === 0 && <UploadStep wl={wl} />}
        {step === 1 && result && <PreviewStep result={result} />}
        {step === 2 && result && wl.file && <DownloadStep text={result.text} original={wl.file.text} handle={wl.handle} />}
      </DialogContent>
      <DialogActions>
        {step > 0 && <Button onClick={() => setStep(step - 1)}>{t('profiles.wl.back')}</Button>}
        <Button onClick={close}>{step === 2 ? t('profiles.wl.done') : t('profiles.wl.cancel')}</Button>
        {step < 2 && (
          <Button variant="contained" disabled={!canNext} onClick={() => setStep(step + 1)}>
            {t('profiles.wl.next')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
