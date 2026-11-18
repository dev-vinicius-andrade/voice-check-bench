import LinearProgress from '@mui/material/LinearProgress'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { QUIET_SEC, RECORD_SEC } from '../../../desktop/autotune/recorder'
import { LevelMeter } from '../../common/LevelMeter'

/** While recording: the quiet countdown, then the text to read; a progress bar and the mic level. */
export function RecordProgress({ seconds, levelDb, talking }: { seconds: number; levelDb: number; talking: boolean }) {
  const { t } = useTranslation()
  const whole = Math.min(RECORD_SEC, Math.floor(seconds))
  return (
    <div className="grid gap-3" data-testid="autotune-recording">
      {talking ? (
        <div className="grid gap-2">
          <Typography variant="subtitle1" component="p">{t('desktop.autotune.ui.record.talk')}</Typography>
          <Typography variant="h6" component="p" sx={{ fontWeight: 500, lineHeight: 1.6 }}>{t('wizard.reading.passage')}</Typography>
          <Typography variant="body2" color="text.secondary">{t('desktop.autotune.ui.record.keepTalking')}</Typography>
        </div>
      ) : (
        <Typography variant="h6" component="p" role="status">
          {t('desktop.autotune.ui.record.quiet', { sec: Math.max(1, Math.ceil(QUIET_SEC - seconds)) })}
        </Typography>
      )}
      <div className="grid gap-1">
        <LinearProgress variant="determinate" value={Math.min(100, (seconds / RECORD_SEC) * 100)} aria-label={t('desktop.autotune.ui.record.progress', { sec: whole, total: RECORD_SEC })} />
        <Typography variant="caption" color="text.secondary" data-testid="autotune-seconds">
          {t('desktop.autotune.ui.record.progress', { sec: whole, total: RECORD_SEC })}
        </Typography>
      </div>
      <div className="flex items-center gap-3">
        <Typography variant="body2" color="text.secondary">{t('desktop.autotune.ui.record.level')}</Typography>
        <div className="min-w-0 flex-1">
          <LevelMeter db={levelDb} width="100%" />
        </div>
      </div>
    </div>
  )
}
