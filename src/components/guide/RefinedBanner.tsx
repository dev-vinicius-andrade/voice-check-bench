import Alert from '@mui/material/Alert'
import AlertTitle from '@mui/material/AlertTitle'
import Button from '@mui/material/Button'
import { useTranslation } from 'react-i18next'
import { useGuideOverride } from './guideOverride'

/** Shown while the guide uses refined settings (see guideOverride.ts); "Show the original settings" clears them. */
export function RefinedBanner() {
  const { t } = useTranslation()
  const refined = useGuideOverride((s) => s.refined)
  const clear = useGuideOverride((s) => s.clear)
  if (!refined) return null
  return (
    <Alert
      severity="info"
      data-testid="guide-refined"
      action={<Button size="small" color="inherit" onClick={clear}>{t('guide.refined.original')}</Button>}
    >
      <AlertTitle>{t('guide.refined.title', { n: refined.attempt })}</AlertTitle>
      {t('guide.refined.text', { dist: refined.dist })}
    </Alert>
  )
}
