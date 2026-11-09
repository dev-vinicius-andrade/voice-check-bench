import { useId, useMemo } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { captureStates } from '../../profiles/build'
import type { Profile } from '../../profiles/types'
import { UploadStep } from '../wavelink/UploadStep'
import { useWaveLinkFile } from '../wavelink/useWaveLinkFile'

export interface CaptureDialogProps {
  open: boolean
  p: Profile
  onClose(): void
  onSave(states: Record<string, string>): void
}

/** Upload the current Wave Link file and keep its exact plugin states in the profile (e.g. a hand-configured ReaFIR). */
export function CaptureDialog({ open, p, onClose, onSave }: CaptureDialogProps) {
  const { t } = useTranslation()
  const titleId = useId()
  const wl = useWaveLinkFile()
  const states = useMemo(() => (wl.file && wl.inputKey ? captureStates(wl.file, wl.inputKey) : null), [wl.file, wl.inputKey])
  const count = states ? Object.keys(states).length : 0
  const close = (): void => {
    wl.reset()
    onClose()
  }
  return (
    <Dialog open={open} onClose={close} aria-labelledby={titleId} fullWidth maxWidth="sm">
      <DialogTitle id={titleId}>{`${t('profiles.capture.title')} · ${p.name}`}</DialogTitle>
      <DialogContent className="grid gap-3">
        <Typography variant="body2">{t('profiles.capture.lead')}</Typography>
        <UploadStep wl={wl} />
        {states && <Alert severity="info">{t('profiles.capture.count', { count })}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>{t('profiles.wl.cancel')}</Button>
        <Button
          variant="contained"
          disabled={!states || count === 0}
          onClick={() => {
            if (states) onSave(states)
            close()
          }}
        >
          {t('profiles.capture.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
