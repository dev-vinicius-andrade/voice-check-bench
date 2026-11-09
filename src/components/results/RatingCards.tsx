import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { ratingTitle } from '../../plain/ratings'
import type { Rating } from '../../plain/types'
import type { Status } from '../../types'
import { MsgText } from '../common/MsgText'

const COLOR: Record<Status, string> = { good: 'success.main', warn: 'warning.main', bad: 'error.main' }

/** The three everyday ratings: background noise, your volume, sound of your voice. */
export function RatingCards({ ratings }: { ratings: readonly Rating[] }) {
  const { t } = useTranslation()
  return (
    <section aria-label={t('results.ratings.aria')} className="grid gap-3 sm:grid-cols-3">
      {ratings.map((r) => (
        <Paper key={r.id} className="grid content-start gap-1 px-4 py-3">
          <Typography variant="body2" color="text.secondary" component="h3" sx={{ fontWeight: 600 }}>
            <MsgText msg={ratingTitle(r.id)} />
          </Typography>
          <Typography sx={{ fontWeight: 700, fontSize: 18, color: COLOR[r.status] }}>
            <MsgText msg={r.label} />
          </Typography>
          <Typography variant="body2" color="text.secondary">
            <MsgText msg={r.explain} />
          </Typography>
        </Paper>
      ))}
    </section>
  )
}
