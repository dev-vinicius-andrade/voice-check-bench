import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import DownloadIcon from '@mui/icons-material/Download'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { downloadTakeWav } from '../results/download'
import { useMsg } from '../common/MsgText'
import { quickStats } from '../../audio/quickStats'
import { QUIET_SEC } from '../../audio/reference'
import { fmtDb, fmtDbfs, fmtNum } from '../../i18n/format'
import { clarityScore, scoreBand } from '../../plain/score'
import { useBench } from '../../store/benchStore'
import { isAnalysisError } from '../../types'
import type { Take } from '../../types'
import { failureKey } from './failureKey'

interface TakeSummaryProps {
  take: Take
}

const BORDER = { clear: 'success.main', good: 'success.main', ok: 'warning.main', hard: 'error.main' } as const

/** Play + Download WAV. */
function PlayRow({ take, label }: { take: Take; label: string }) {
  const { t } = useTranslation()
  const playTake = useBench((s) => s.playTake)
  return (
    <span className="inline-flex flex-wrap gap-2">
      <Button variant="outlined" size="small" startIcon={<PlayArrowIcon />} onClick={() => playTake(take.id)}>
        {label}
      </Button>
      <Button variant="text" size="small" startIcon={<DownloadIcon />} onClick={() => downloadTakeWav(take)}>
        {t('common.actions.downloadWav')}
      </Button>
    </span>
  )
}

/** A take that could not be analysed: what happened and what to do, small numbers below. */
function FailedTake({ take }: TakeSummaryProps) {
  const { t } = useTranslation()
  const q = quickStats(take.samples, take.sampleRate)
  return (
    <Paper className="grid gap-2.5 px-4 py-3.5" sx={{ borderLeft: 4, borderLeftColor: BORDER.hard }}>
      <Typography sx={{ fontWeight: 700 }}>{t('wizard.take.failed')}</Typography>
      <Typography variant="body2">{t(failureKey(q))}</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {t('wizard.take.failedDetails', {
          duration: t('common.units.seconds', { value: fmtNum(q.duration, 1) }),
          peak: fmtDbfs(q.peakDb, 0),
          silence: fmtDbfs(q.silenceDb, 0),
          reading: fmtDbfs(q.readingDb, 0),
          device: take.device || '—',
        })}
      </Typography>
      <div>
        <PlayRow take={take} label={t('common.actions.playBack')} />
      </div>
    </Paper>
  )
}

/** Mini summary of the take on the step screen: clarity score and headline, small numbers, play, replace hint. */
export function TakeSummary({ take }: TakeSummaryProps) {
  const { t } = useTranslation()
  const tm = useMsg()
  const a = take.analysis
  if (isAnalysisError(a)) return <FailedTake take={take} />

  const score = clarityScore(a)
  return (
    <Paper className="grid gap-2 px-4 py-3.5" sx={{ borderLeft: 4, borderLeftColor: BORDER[scoreBand(score.score)] }}>
      <Typography sx={{ fontWeight: 700 }}>
        {t('wizard.take.saved', { score: fmtNum(score.score, 0), headline: tm(score.headline) })}
      </Typography>
      <Typography variant="body2">{tm(score.explain)}</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {t('wizard.take.details', { speech: fmtDbfs(a.speechMed, 1), noise: fmtDbfs(a.noise, 0), snr: fmtDb(a.snr, 0, false) })}
      </Typography>
      {a.quietBroken && (
        <Typography variant="body2" color="text.secondary">
          {t('wizard.take.quietBroken', { sec: fmtNum(QUIET_SEC, 0) })}
        </Typography>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <PlayRow take={take} label={t('common.actions.play')} />
        <Typography variant="body2" color="text.secondary">
          {t('wizard.take.replace')}
        </Typography>
      </div>
    </Paper>
  )
}
