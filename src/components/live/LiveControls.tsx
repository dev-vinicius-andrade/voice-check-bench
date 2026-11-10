import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import { useTranslation } from 'react-i18next'
import { fmtNum } from '../../i18n/format'
import type { LiveError, LiveMetrics, LiveStatus } from '../../live/types'

/** "Listening · in sync (12 ms)" / "lining up…" / "only Wave Link output". */
export function LiveStatusChip({ metrics, fxOnly }: { metrics: LiveMetrics | null; fxOnly: boolean }) {
  const { t } = useTranslation()
  let label: string
  let color: 'success' | 'info' = 'info'
  if (fxOnly || metrics?.raw === null) label = t('live.status.fxOnly')
  else if (metrics && metrics.lagMs !== null) {
    label = t('live.status.sync', { ms: fmtNum(metrics.lagMs, 0) })
    color = 'success'
  } else label = t('live.status.lining')
  return <Chip size="small" color={color} variant="outlined" label={label} data-testid="live-status" />
}

interface StartStopProps {
  status: LiveStatus
  canStart: boolean
  onStart(): void
  onStop(): void
}

/** Start listening / Stop. */
export function StartStopButton({ status, canStart, onStart, onStop }: StartStopProps) {
  const { t } = useTranslation()
  if (status === 'running')
    return <Button variant="outlined" color="error" onClick={onStop}>{t('live.controls.stop')}</Button>
  return (
    <Button variant="contained" onClick={onStart} disabled={!canStart || status === 'starting'}>
      {status === 'starting' ? t('live.controls.starting') : t('live.controls.start')}
    </Button>
  )
}

/** One alert per LiveError; rawUnavailable offers to run on the Wave Link output only. */
export function LiveErrorAlert({ error, onFxOnly }: { error: LiveError; onFxOnly(): void }) {
  const { t } = useTranslation()
  return (
    <Alert severity={error === 'rawUnavailable' ? 'warning' : 'error'} data-testid={`live-error-${error}`}>
      <div className="grid justify-items-start gap-2">
        <span>{t(`live.error.${error}`)}</span>
        {error === 'rawUnavailable' && (
          <Button color="inherit" variant="outlined" size="small" onClick={onFxOnly}>{t('live.error.useFxOnly')}</Button>
        )}
      </div>
    </Alert>
  )
}
