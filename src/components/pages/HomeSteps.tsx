import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { fmtNum } from '../../i18n/format'
import { HOME_STEPS } from './howItWorksData'

/** The four steps of the check as numbered cards (4 → 2 → 1 columns). */
export function HomeSteps() {
  const { t } = useTranslation()
  return (
    <section aria-label={t('pages.home.stepsLabel')} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {HOME_STEPS.map((id, i) => (
        <Paper key={id} className="grid content-start gap-1 p-4">
          <Typography variant="h4" component="p" color="primary">
            {fmtNum(i + 1, 0)}
          </Typography>
          <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 700 }}>
            {t(`pages.home.steps.${id}.title`)}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t(`pages.home.steps.${id}.sub`)}
          </Typography>
        </Paper>
      ))}
    </section>
  )
}
