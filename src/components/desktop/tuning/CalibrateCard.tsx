import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import type { AudioMonitor } from '../../../desktop/types'
import { useMsg } from '../../common/MsgText'
import { CalibrateProgress } from './CalibrateProgress'
import { CalibrateResult } from './CalibrateResult'
import type { NoiseCalibration } from './useNoiseCalibration'

interface CalibrateCardProps {
  cal: NoiseCalibration
  /** Engine monitor while running; null when stopped. */
  monitor: AudioMonitor | null
  onMonitor: (m: AudioMonitor) => void
}

/** "Calibrate noise" (SPEC "Calibrate noise live"): stay quiet, the app sets the noise removal while you hear it, then talk. */
export function CalibrateCard({ cal, monitor, onMonitor }: CalibrateCardProps) {
  const { t } = useTranslation()
  const tm = useMsg()
  const { view } = cal
  const busy = view.phase === 'quiet' || view.phase === 'set' || view.phase === 'talk' || view.phase === 'verify'
  return (
    <Paper component="section" className="grid gap-3 p-4" aria-labelledby="tune-calibrate-title" data-testid="tune-calibrate">
      <div className="flex flex-wrap items-center gap-2">
        <div className="grid min-w-0 flex-1 gap-0.5">
          <Typography id="tune-calibrate-title" variant="h6" component="h2">{t('desktop.tune.calibrate.title')}</Typography>
          {!busy && <Typography variant="body2" color="text.secondary">{t('desktop.tune.calibrate.lead')}</Typography>}
        </div>
        {busy ? (
          <Button onClick={cal.cancel}>{t('desktop.tune.calibrate.cancel')}</Button>
        ) : (
          <Button variant={view.phase === 'done' ? 'outlined' : 'contained'} disabled={!cal.ready} onClick={cal.start}>
            {t(view.phase === 'done' ? 'desktop.tune.calibrate.again' : 'desktop.tune.calibrate.start')}
          </Button>
        )}
      </div>
      {!cal.ready && !busy && (
        <Typography variant="body2" color="text.secondary" data-testid="tune-calibrate-needs">{t('desktop.tune.calibrate.needEngine')}</Typography>
      )}
      {cal.ready && monitor === 'off' && (
        <Alert
          severity="info"
          data-testid="tune-calibrate-hear"
          action={
            <Button color="inherit" size="small" onClick={() => onMonitor('processed')}>
              {t('desktop.tune.calibrate.hearButton')}
            </Button>
          }
        >
          {t('desktop.tune.calibrate.hearOff')}
        </Alert>
      )}
      {view.notice && (
        <Alert severity="info" data-testid="tune-calibrate-notice">{tm(view.notice)}</Alert>
      )}
      {busy && <CalibrateProgress view={view} />}
      {view.phase === 'done' && view.summary && (
        <CalibrateResult summary={view.summary} canMore={view.canMore} canLess={view.canLess} onMore={cal.more} onLess={cal.less} onUndo={cal.undo} />
      )}
    </Paper>
  )
}
