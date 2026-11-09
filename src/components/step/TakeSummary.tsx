import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import DownloadIcon from '@mui/icons-material/Download'
import { downloadTakeWav } from '../results/download'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { countByStatus, diagnose, f1, topIssues } from '../../audio/diagnose'
import { failureHint, quickStats } from '../../audio/quickStats'
import { deviations } from '../../audio/reference'
import { useBench } from '../../store/benchStore'
import { isAnalysisError } from '../../types'
import type { Analysis, Take } from '../../types'

interface TakeSummaryProps {
  take: Take
}

const BORDER = { good: 'success.main', warn: 'warning.main', bad: 'error.main' } as const

function Stats({ a }: { a: Analysis }) {
  const dev = deviations(a.rel)
  const items: [string, string, string][] = [
    ['speech', a.speechMed.toFixed(1), ' dBFS'],
    ['noise', a.noise.toFixed(0), ' dBFS'],
    ['SNR', a.snr.toFixed(0), ' dB'],
    ['boom', f1(dev[1]), ''],
    ['body', f1(dev[4]), ''],
  ]
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1">
      {items.map(([name, value, unit]) => (
        <Typography key={name} variant="body2" color="text.secondary">
          {name}{' '}
          <Typography component="b" color="text.primary" sx={{ fontWeight: 700, fontSize: 15 }}>
            {value}
          </Typography>
          {unit}
        </Typography>
      ))}
    </div>
  )
}

/** Mini summary of the take on the step screen: verdict, key numbers, play, replace hint. */
export function TakeSummary({ take }: TakeSummaryProps) {
  const playTake = useBench((s) => s.playTake)
  const a = take.analysis
  const play = (label: string) => (
    <span className="inline-flex flex-wrap gap-2">
      <Button variant="outlined" size="small" startIcon={<PlayArrowIcon />} onClick={() => playTake(take.id)}>
        {label}
      </Button>
      <Button variant="text" size="small" startIcon={<DownloadIcon />} onClick={() => downloadTakeWav(take)}>
        Download WAV
      </Button>
    </span>
  )

  if (isAnalysisError(a)) {
    const q = quickStats(take.samples, take.sampleRate)
    const db = (v: number) => (Number.isFinite(v) ? `${v.toFixed(0)} dBFS` : '—')
    return (
      <Paper className="grid gap-2.5 px-4 py-3.5" sx={{ borderLeft: 4, borderLeftColor: BORDER.bad }}>
        <Typography sx={{ fontWeight: 700 }}>This take could not be analyzed</Typography>
        <Typography variant="body2">{failureHint(q)}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
          {q.duration.toFixed(1)} s · peak {db(q.peakDb)} · silence {db(q.silenceDb)} · reading {db(q.readingDb)} · input{' '}
          {take.device || '—'}
        </Typography>
        <div>{play('Play it back')}</div>
      </Paper>
    )
  }

  const checks = diagnose(a)
  const { bad, warn } = countByStatus(checks)
  const worst = bad ? 'bad' : warn ? 'warn' : 'good'
  const top = topIssues(checks).map((c) => c.title.replace(/\s*\(.*\)/, ''))

  return (
    <Paper className="grid gap-2.5 px-4 py-3.5" sx={{ borderLeft: 4, borderLeftColor: BORDER[worst] }}>
      <Typography sx={{ fontWeight: 700 }}>Saved. {top.length ? `Watch: ${top.join(' · ')}` : 'Nothing stands out.'}</Typography>
      <Stats a={a} />
      {a.quietBroken && (
        <Typography variant="body2" color="text.secondary">
          There was sound during the first 3 s, so the noise reading may be off.
        </Typography>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {play('Play')}
        <Typography variant="body2" color="text.secondary">
          Not happy? Press record again to replace it.
        </Typography>
      </div>
    </Paper>
  )
}
