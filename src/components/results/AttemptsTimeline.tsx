import Chip from '@mui/material/Chip'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { fmtNum } from '../../i18n/format'
import type { Attempt } from './useRefineLoop'

/** "Attempt 1 · 35 → 0 ✗", "Attempt 2 · 35 → 58 ✓": every processed take of the session recorded with applied settings. */
export function AttemptsTimeline({ attempts, currentId }: { attempts: Attempt[]; currentId: number }) {
  const { t } = useTranslation()
  return (
    <Paper component="section" aria-labelledby="attempts-title" className="grid gap-2 p-4" data-testid="attempts-timeline">
      <Typography id="attempts-title" variant="subtitle1" component="h2" sx={{ fontWeight: 700 }}>
        {t('results.attempts.title')}
      </Typography>
      <ol className="m-0 grid list-none gap-1.5 p-0">
        {attempts.map((x) => (
          <li key={x.id} className="flex flex-wrap items-center gap-2" aria-current={x.id === currentId ? 'step' : undefined}>
            <Typography variant="body2" sx={{ fontWeight: x.id === currentId ? 700 : 400, fontVariantNumeric: 'tabular-nums' }}>
              {t('results.attempts.item', { n: x.n, raw: fmtNum(x.rawScore, 0), fx: fmtNum(x.fxScore, 0) })}
            </Typography>
            <Chip
              size="small"
              color={x.improved ? 'success' : 'error'}
              variant="outlined"
              label={`${x.improved ? '✓' : '✗'} ${t(x.improved ? 'results.attempts.better' : x.mismatch ? 'results.attempts.otherDist' : 'results.attempts.notYet')}`}
            />
          </li>
        ))}
      </ol>
    </Paper>
  )
}
