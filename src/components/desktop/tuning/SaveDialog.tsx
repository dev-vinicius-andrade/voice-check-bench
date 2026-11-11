import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { slotAt } from '../../../desktop/advice/chain'
import { describeDiff } from '../../../desktop/diffLines'
import { canonicalName } from '../../../wavelink/plugins'
import { useMsg } from '../../common/MsgText'
import { FlowReportView } from './FlowReportView'
import type { ChainModel } from './useChainState'
import type { SaveFlow } from './useSaveFlow'

/** Diff, confirm, save; when Wave Link does not close it asks again before forcing it; then the verify result. */
export function SaveDialog({ flow, model }: { flow: SaveFlow; model: ChainModel | null }) {
  const { t } = useTranslation()
  const tm = useMsg()
  const s = flow.state
  const busy = s.step === 'loading' || s.step === 'saving'
  const asking = s.step === 'confirm' || s.step === 'force' || s.step === 'saving'
  const plan = asking ? s.plan : null
  const lines = s.step === 'confirm' ? describeDiff(s.lines, s.plan.changes, model?.entries ?? []) : []
  const name = (i: number): string => canonicalName((model && slotAt(model.undo.chain, i)?.name) ?? '')
  return (
    <Dialog open={s.step !== 'closed'} onClose={busy ? undefined : flow.close} maxWidth="sm" fullWidth aria-labelledby="tune-save-title">
      <DialogTitle id="tune-save-title">{t('desktop.save.title')}</DialogTitle>
      <DialogContent className="grid gap-3">
        {s.step === 'loading' && <Typography>{t('desktop.save.loading')}</Typography>}
        {s.step === 'saving' && <Typography>{t('desktop.save.saving')}</Typography>}
        {s.step === 'confirm' &&
          (lines.length ? (
            <>
              <Typography variant="body2">{t('desktop.save.lead')}</Typography>
              <ul className="m-0 grid gap-1 pl-5" aria-label={t('desktop.save.listLabel')} data-testid="tune-save-lines">
                {lines.map((m, i) => (
                  <Typography component="li" variant="body2" key={`${m.key}-${i}`}>
                    {tm(m)}
                  </Typography>
                ))}
              </ul>
            </>
          ) : (
            <Alert severity="info">{t('desktop.save.nothing')}</Alert>
          ))}
        {s.step === 'confirm' && s.plan.unsaved.length > 0 && (
          <Alert severity="warning" data-testid="tune-save-unsaved">
            {s.plan.unsaved.map((i) => t('desktop.save.unsaved', { plugin: name(i) })).join(' ')}
          </Alert>
        )}
        {s.step === 'force' && <Alert severity="warning">{t('desktop.save.force')}</Alert>}
        {s.step === 'error' && <Alert severity="error">{tm(s.msg)}</Alert>}
        {s.step === 'done' && <FlowReportView report={s.report} kind="save" />}
      </DialogContent>
      <DialogActions>
        <Button onClick={flow.close} disabled={busy}>
          {t(asking ? 'desktop.save.cancel' : 'desktop.save.close')}
        </Button>
        {s.step === 'force' && (
          <Button variant="contained" color="warning" onClick={() => flow.confirm(true)}>
            {t('desktop.save.forceConfirm')}
          </Button>
        )}
        {(s.step === 'confirm' || s.step === 'saving') && (
          <Button variant="contained" onClick={() => flow.confirm(false)} disabled={busy || !plan?.changes.length}>
            {t('desktop.save.confirm')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
