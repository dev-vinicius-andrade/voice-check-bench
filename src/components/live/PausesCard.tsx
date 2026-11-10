import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { fmtNum } from '../../i18n/format'
import type { LiveMetrics } from '../../live/types'
import { LivePanel } from './LivePanel'

/** Share of dead silence above which noise removal is called too strong. */
const DEAD_SILENCE_WARN = 0.05

/** Room noise between words, raw → Wave Link, how much quieter, and the dead-silence warning. */
export function PausesCard({ metrics }: { metrics: LiveMetrics }) {
  const { t } = useTranslation()
  const { fx, raw } = metrics
  const fxOk = Number.isFinite(fx.pauseDb)
  const rawOk = raw !== null && Number.isFinite(raw.pauseDb)
  const diff = rawOk ? raw.pauseDb - fx.pauseDb : NaN
  return (
    <LivePanel title={t('live.pauses.title')} lead={t('live.pauses.lead')} testId="live-pauses">
      {fxOk ? (
        <>
          <Typography sx={{ fontSize: { xs: 26, sm: 32 }, fontWeight: 800, lineHeight: 1.15 }} data-testid="live-pause-values">
            {rawOk
              ? t('live.pauses.values', { raw: fmtNum(raw.pauseDb, 0), fx: fmtNum(fx.pauseDb, 0) })
              : t('live.pauses.fxValue', { fx: fmtNum(fx.pauseDb, 0) })}
          </Typography>
          {Number.isFinite(diff) && (
            <Typography variant="body2" color="text.secondary">
              {diff >= 0 ? t('live.pauses.quieter', { db: fmtNum(diff, 0) }) : t('live.pauses.louder', { db: fmtNum(-diff, 0) })}
            </Typography>
          )}
        </>
      ) : (
        <Typography variant="body2" color="text.secondary">{t('live.pauses.none')}</Typography>
      )}
      {fx.deadSilence > DEAD_SILENCE_WARN && (
        <Typography variant="body2" color="warning.main" sx={{ fontWeight: 600 }} data-testid="live-dead">
          {t('live.pauses.dead', { pct: fmtNum(fx.deadSilence * 100, 0) })}
        </Typography>
      )}
    </LivePanel>
  )
}
