import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { fmtNum } from '../../../i18n/format'
import { useMsg } from '../../common/MsgText'
import type { PendingFeedback, Rating } from './useAdviceFeedback'

interface ApplyFeedbackProps {
  pending: PendingFeedback | null
  leftMs: number
  onRate: (r: Rating) => void
}

/** After Apply: the change, a countdown while the new sound settles, then "Does it sound better?". */
export function ApplyFeedback({ pending, leftMs, onRate }: ApplyFeedbackProps) {
  const { t } = useTranslation()
  const tm = useMsg()
  if (!pending) return null
  return (
    <Paper variant="outlined" className="grid gap-2 p-3" sx={{ borderColor: 'primary.main', borderWidth: 2 }} data-testid="tune-feedback">
      <Typography variant="body2" sx={{ fontWeight: 700 }}>
        {t('desktop.tune.feedback.applied', { change: tm(pending.advice.changeMsg) })}
      </Typography>
      {leftMs > 0 ? (
        <Typography variant="body2" color="text.secondary" role="status" data-testid="tune-feedback-wait">
          {t('desktop.tune.feedback.listening', { sec: fmtNum(Math.ceil(leftMs / 1000), 0) })}
        </Typography>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Typography variant="body2" className="mr-auto">{t('desktop.tune.feedback.ask')}</Typography>
          <Button size="small" variant="outlined" onClick={() => onRate('better')}>{t('desktop.tune.feedback.better')}</Button>
          <Button size="small" variant="outlined" onClick={() => onRate('same')}>{t('desktop.tune.feedback.same')}</Button>
          <Button size="small" variant="outlined" onClick={() => onRate('worse')}>{t('desktop.tune.feedback.worse')}</Button>
        </div>
      )}
    </Paper>
  )
}
