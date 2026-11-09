import LinearProgress from '@mui/material/LinearProgress'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { MAX_SEC, QUIET_SEC } from '../../audio/reference'
import { fmtNum } from '../../i18n/format'
import { useBench } from '../../store/benchStore'

type CueColor = 'text.secondary' | 'warning.main' | 'success.main'

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** Idle hint, silence countdown, reading timer or analyzing, with a progress bar under it. */
export function RecordingCue() {
  const { t } = useTranslation()
  const phase = useBench((s) => s.recorder.phase)
  const elapsed = useBench((s) => s.recorder.elapsed)

  let big = ''
  let label = t('wizard.cue.idle', { sec: fmtNum(QUIET_SEC, 0) })
  let color: CueColor = 'text.secondary'
  let fraction = 0
  if (phase === 'silence') {
    big = fmtNum(Math.max(1, Math.ceil(QUIET_SEC - elapsed)), 0)
    label = t('wizard.cue.silence')
    color = 'warning.main'
    fraction = clamp01(elapsed / QUIET_SEC)
  } else if (phase === 'reading') {
    big = t('common.units.seconds', { value: fmtNum(Math.max(0, elapsed - QUIET_SEC), 0) })
    label = t('wizard.cue.reading')
    color = 'success.main'
    fraction = clamp01((elapsed - QUIET_SEC) / (MAX_SEC - QUIET_SEC))
  } else if (phase === 'analyzing') {
    big = '…'
    label = t('wizard.cue.analyzing')
  }

  return (
    <div className="grid gap-2" role="status" aria-live="polite">
      <div className="flex min-h-[46px] flex-wrap items-center justify-center gap-3 text-center">
        {big && (
          <Typography component="span" sx={{ fontSize: 34, fontWeight: 700, lineHeight: 1, fontVariantNumeric: 'tabular-nums', color }}>
            {big}
          </Typography>
        )}
        <Typography component="span" sx={{ fontSize: 17, fontWeight: phase === 'idle' ? 600 : 700, color }}>
          {label}
        </Typography>
      </div>
      {phase === 'analyzing' ? (
        <LinearProgress sx={{ height: 6, borderRadius: 999 }} />
      ) : (
        <LinearProgress
          variant="determinate"
          value={fraction * 100}
          color={phase === 'silence' ? 'warning' : 'success'}
          sx={{ height: 6, borderRadius: 999, '& .MuiLinearProgress-bar': { borderRadius: 999 } }}
        />
      )}
    </div>
  )
}
