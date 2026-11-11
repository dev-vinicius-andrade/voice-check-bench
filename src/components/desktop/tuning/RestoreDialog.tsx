import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { fmtDateTime } from '../../../i18n/format'
import { useMsg } from '../../common/MsgText'
import { FlowReportView } from './FlowReportView'
import type { RestoreFlow } from './useRestoreFlow'

/** "Restore backup": pick a backup, confirm, write it back; when Wave Link does not close it asks again before forcing it. */
export function RestoreDialog({ flow }: { flow: RestoreFlow }) {
  const { t } = useTranslation()
  const tm = useMsg()
  const s = flow.state
  const busy = s.step === 'loading' || s.step === 'restoring'
  const asking = s.step === 'pick' || s.step === 'force' || s.step === 'restoring'
  return (
    <Dialog open={s.step !== 'closed'} onClose={busy ? undefined : flow.close} maxWidth="sm" fullWidth aria-labelledby="tune-restore-title">
      <DialogTitle id="tune-restore-title">{t('desktop.restore.title')}</DialogTitle>
      <DialogContent className="grid gap-3">
        {s.step === 'loading' && <Typography>{t('desktop.restore.loading')}</Typography>}
        {s.step === 'restoring' && <Typography>{t('desktop.restore.restoring')}</Typography>}
        {s.step === 'pick' &&
          (s.backups.length ? (
            <>
              <Typography variant="body2">{t('desktop.restore.lead')}</Typography>
              <RadioGroup value={s.selected ?? ''} onChange={(e) => flow.select(e.target.value)} aria-label={t('desktop.restore.listLabel')}>
                {s.backups.map((b) => (
                  <FormControlLabel key={b.path} value={b.path} control={<Radio size="small" />} label={`${b.name} · ${fmtDateTime(b.modifiedMs)}`} />
                ))}
              </RadioGroup>
            </>
          ) : (
            <Alert severity="info">{t('desktop.restore.none')}</Alert>
          ))}
        {s.step === 'force' && <Alert severity="warning">{t('desktop.save.force')}</Alert>}
        {s.step === 'error' && <Alert severity="error">{tm(s.msg)}</Alert>}
        {s.step === 'done' && <FlowReportView report={s.report} kind="restore" />}
      </DialogContent>
      <DialogActions>
        <Button onClick={flow.close} disabled={busy}>
          {t(asking ? 'desktop.save.cancel' : 'desktop.save.close')}
        </Button>
        {s.step === 'pick' && s.backups.length > 0 && (
          <Button variant="contained" onClick={() => flow.confirm(false)} disabled={!s.selected}>
            {t('desktop.restore.confirm')}
          </Button>
        )}
        {s.step === 'force' && (
          <Button variant="contained" color="warning" onClick={() => flow.confirm(true)}>
            {t('desktop.restore.forceConfirm')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
