import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { LEVEL_GOOD_MAX, LEVEL_GOOD_MIN } from '../../audio/diagnose'
import { fmtDbfs, fmtNum } from '../../i18n/format'
import type { HeldMetrics } from '../../live/hold'
import { LivePanel } from './LivePanel'
import { levelColor, levelWord, meterPct } from './liveScale'

function Marker({ db, color, testId }: { db: number; color: string; testId: string }) {
  if (!Number.isFinite(db)) return null
  return (
    <Box
      data-testid={testId}
      sx={{ position: 'absolute', top: -4, bottom: -4, width: 4, ml: '-2px', borderRadius: 1, bgcolor: color, left: `${meterPct(db)}%` }}
    />
  )
}

/** Wave Link speech level, a plain word, a −60..0 dBFS meter with the target band, and clipping. */
export function LoudnessCard({ metrics }: { metrics: HeldMetrics }) {
  const { t } = useTranslation()
  const { fx, raw } = metrics
  const word = levelWord(fx)
  const color = levelColor(word)
  const lo = meterPct(LEVEL_GOOD_MIN)
  const hi = meterPct(LEVEL_GOOD_MAX)
  return (
    <LivePanel title={t('live.loudness.title')} testId="live-loudness" heardAgoMs={fx.heardAgoMs}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Typography sx={{ fontSize: { xs: 32, sm: 40 }, fontWeight: 800, lineHeight: 1.1 }} data-testid="live-level">
          {fmtDbfs(fx.speechDb)}
        </Typography>
        <Typography sx={{ fontWeight: 700 }} color={color ? `${color}.main` : 'text.secondary'} data-testid="live-level-word">
          {t(`live.loudness.word.${word}`)}
        </Typography>
      </div>
      <Box
        role="img"
        aria-label={t('live.loudness.meter', { min: fmtNum(LEVEL_GOOD_MIN, 0), max: fmtNum(LEVEL_GOOD_MAX, 0) })}
        sx={{ position: 'relative', height: 12, my: 0.5, borderRadius: 1, bgcolor: 'action.hover' }}
      >
        <Box sx={{ position: 'absolute', top: 0, bottom: 0, left: `${lo}%`, width: `${hi - lo}%`, bgcolor: 'success.main', opacity: 0.3 }} />
        {raw && <Marker db={raw.speechDb} color="text.disabled" testId="live-marker-raw" />}
        <Marker db={fx.speechDb} color={color ? `${color}.main` : 'text.secondary'} testId="live-marker-fx" />
      </Box>
      <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
        {raw && (
          <Typography variant="caption" color="text.secondary">{t('live.loudness.raw', { v: fmtDbfs(raw.speechDb) })}</Typography>
        )}
        <Typography variant="caption" sx={{ fontWeight: 600 }}>{t('live.loudness.fx', { v: fmtDbfs(fx.speechDb) })}</Typography>
      </div>
      {fx.clipFrames > 0 && (
        <Typography variant="body2" color="error.main" sx={{ fontWeight: 600 }} data-testid="live-clip">
          {t('live.loudness.clip', { count: fx.clipFrames })}
        </Typography>
      )}
    </LivePanel>
  )
}
