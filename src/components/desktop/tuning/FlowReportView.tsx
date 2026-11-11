import Alert from '@mui/material/Alert'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import type { WlFlowReport } from '../../../desktop/types'

/** What a save or restore did: verified or not, Wave Link restarted, where the backup is. */
export function FlowReportView({ report, kind }: { report: WlFlowReport; kind: 'save' | 'restore' }) {
  const { t } = useTranslation()
  const verified = report.steps.includes('verified')
  return (
    <div className="grid gap-2" data-testid="tune-flow-report">
      <Alert severity={verified || !report.written ? 'success' : 'warning'}>
        {!report.written ? t('desktop.save.unchanged') : verified ? t(`desktop.${kind}.done`) : t('desktop.save.notVerified')}
      </Alert>
      {report.written && <Typography variant="body2">{t(report.restarted ? 'desktop.save.restarted' : 'desktop.save.notRunning')}</Typography>}
      {report.forced && <Typography variant="body2">{t('desktop.save.forced')}</Typography>}
      {report.backupPath && (
        <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
          {t('desktop.save.backup', { path: report.backupPath })}
        </Typography>
      )}
      {kind === 'restore' && report.written && <Typography variant="body2">{t('desktop.restore.restartPreview')}</Typography>}
    </div>
  )
}
