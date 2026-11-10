import ThumbUpIcon from '@mui/icons-material/ThumbUp'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { issueUrl } from '../../community/solutions'
import type { CommunitySolution } from '../../community/types'
import { fmtDb, fmtNum } from '../../i18n/format'
import { distLabel } from '../results/RecordAgainButton'
import { applyCommunitySolution } from './solutionApply'
import { SolutionSettings } from './SolutionSettings'

function Chips({ s }: { s: CommunitySolution }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap gap-1.5">
      {s.style && <Chip size="small" variant="outlined" label={t(`wizard.goal.style.${s.style}.name`)} />}
      <Chip size="small" variant="outlined" label={t(s.noisyRoom ? 'pages.community.solutions.chip.noisy' : 'pages.community.solutions.chip.quiet')} />
      <Chip size="small" variant="outlined" label={t('pages.community.solutions.chip.dist', { dist: distLabel(s.dist) })} />
      {s.snrGain !== null && s.snrGain > 0 && (
        <Chip size="small" color="success" variant="outlined" label={t('pages.community.solutions.chip.gain', { gain: fmtDb(s.snrGain, 0) })} />
      )}
    </div>
  )
}

/** One person's shared settings: votes, context chips, a compact summary, vote / use actions. */
export function SolutionCard({ s, model, canUse }: { s: CommunitySolution; /** Shown when the list mixes mics. */ model?: string; canUse: boolean }) {
  const { t } = useTranslation()
  return (
    <Paper component="li" className="grid gap-3 p-4" data-testid="solution-card">
      <div className="flex items-start justify-between gap-3">
        <Typography sx={{ fontWeight: 700 }}>{model ?? t('pages.community.solutions.issue', { issue: s.issue })}</Typography>
        <Typography
          variant="body2"
          className="flex shrink-0 items-center gap-1"
          aria-label={t('pages.community.solutions.votesLabel', { count: s.votes })}
          sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
        >
          <ThumbUpIcon fontSize="small" color="primary" aria-hidden />
          {fmtNum(s.votes, 0)}
        </Typography>
      </div>
      <Chips s={s} />
      <SolutionSettings s={s.suggestion} />
      <div className="flex flex-wrap gap-2">
        <Button size="small" variant="outlined" href={issueUrl(s.issue)} target="_blank" rel="noopener noreferrer">
          {t('pages.community.solutions.vote')}
        </Button>
        {canUse && (
          <Button size="small" variant="contained" onClick={() => applyCommunitySolution(s)}>
            {t('pages.community.solutions.use')}
          </Button>
        )}
      </div>
    </Paper>
  )
}
