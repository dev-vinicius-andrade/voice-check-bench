import Alert from '@mui/material/Alert'
import { useTranslation } from 'react-i18next'
import { fmtNum } from '../../../i18n/format'

/** Mute the mic in Wave Link's monitor mix; the delay the preview adds right now (+ the ReaFIR note). */
export function MonitorAlert({ delayMs, reafirOn }: { delayMs: number | null; reafirOn: boolean }) {
  const { t } = useTranslation()
  return (
    <Alert severity="warning" data-testid="tune-monitor-alert">
      {t('desktop.tune.warn.monitor')}
      {delayMs !== null && <> {t('desktop.tune.warn.delay', { ms: fmtNum(delayMs, 0) })}</>}
      {reafirOn && <> {t('desktop.tune.warn.reafir')}</>}
    </Alert>
  )
}
