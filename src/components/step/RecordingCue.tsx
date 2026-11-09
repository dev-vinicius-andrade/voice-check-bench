import LinearProgress from '@mui/material/LinearProgress'
import Typography from '@mui/material/Typography'
import { MAX_SEC, QUIET_SEC } from '../../audio/reference'
import { useBench } from '../../store/benchStore'

type CueColor = 'text.secondary' | 'warning.main' | 'success.main'

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** Idle hint, silence countdown, reading timer or analyzing, with a progress bar under it. */
export function RecordingCue() {
  const phase = useBench((s) => s.recorder.phase)
  const elapsed = useBench((s) => s.recorder.elapsed)

  let big = ''
  let label = 'Press record, stay silent for 3 seconds, then read the text.'
  let color: CueColor = 'text.secondary'
  let fraction = 0
  if (phase === 'silence') {
    big = String(Math.max(1, Math.ceil(QUIET_SEC - elapsed)))
    label = 'Stay silent, measuring the room'
    color = 'warning.main'
    fraction = clamp01(elapsed / QUIET_SEC)
  } else if (phase === 'reading') {
    big = `${Math.max(0, elapsed - QUIET_SEC).toFixed(0)} s`
    label = 'Read the text now'
    color = 'success.main'
    fraction = clamp01((elapsed - QUIET_SEC) / (MAX_SEC - QUIET_SEC))
  } else if (phase === 'analyzing') {
    big = '…'
    label = 'Analyzing'
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
