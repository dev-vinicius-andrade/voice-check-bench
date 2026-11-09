import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { fmtNum } from '../../i18n/format'
import type { ClarityScore } from '../../plain/types'
import { MsgText } from '../common/MsgText'

const SIZE = 132
const STROKE = 12
const R = (SIZE - STROKE) / 2
const CIRC = 2 * Math.PI * R

/** Ring colour: success ≥ 70, warning 50–69, error < 50. */
const ringColor = (score: number): 'success' | 'warning' | 'error' =>
  score >= 70 ? 'success' : score >= 50 ? 'warning' : 'error'

function Ring({ score }: { score: number }) {
  const { t } = useTranslation()
  const color = `var(--mui-palette-${ringColor(score)}-main)`
  const filled = (Math.max(0, Math.min(100, score)) / 100) * CIRC
  return (
    <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width={SIZE}
        height={SIZE}
        role="img"
        aria-label={t('results.score.aria', { score: fmtNum(score, 0) })}
        data-testid="score-ring"
      >
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="var(--mui-palette-divider)" strokeWidth={STROKE} />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          stroke={color}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${CIRC}`}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        />
      </svg>
      <div className="absolute inset-0 grid content-center justify-items-center" aria-hidden="true">
        <Typography component="span" sx={{ fontSize: 40, fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
          {fmtNum(score, 0)}
        </Typography>
        <Typography component="span" variant="caption" color="text.secondary">{t('results.score.outOf')}</Typography>
      </div>
    </div>
  )
}

/** Clarity score ring with the headline and one-sentence explanation. */
export function ScoreHero({ score }: { score: ClarityScore }) {
  const { t } = useTranslation()
  return (
    <Paper component="section" aria-labelledby="score-headline" className="flex flex-col items-center gap-4 p-5 text-center sm:flex-row sm:text-left">
      <Ring score={score.score} />
      <div className="grid min-w-0 gap-1">
        <Typography variant="overline" color="text.secondary" component="p" sx={{ lineHeight: 1.6 }}>
          {t('results.score.overline')}
        </Typography>
        <Typography id="score-headline" variant="h5" component="h2">
          <MsgText msg={score.headline} />
        </Typography>
        <Typography color="text.secondary">
          <MsgText msg={score.explain} />
        </Typography>
      </div>
    </Paper>
  )
}
