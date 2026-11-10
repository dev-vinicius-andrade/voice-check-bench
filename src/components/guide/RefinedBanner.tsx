import Alert from '@mui/material/Alert'
import AlertTitle from '@mui/material/AlertTitle'
import Button from '@mui/material/Button'
import { useTranslation } from 'react-i18next'
import { communityIssue, useGuideOverride } from './guideOverride'

/** Shown while the guide uses refined or community settings (see guideOverride.ts); "Show the original settings" clears them. */
export function RefinedBanner() {
  const { t } = useTranslation()
  const refined = useGuideOverride((s) => s.refined)
  const clear = useGuideOverride((s) => s.clear)
  if (!refined) return null
  // settings picked on the Community page ("community #<issue>") were not adjusted after a take
  const issue = communityIssue(refined.settings.basedOn)
  return (
    <Alert
      severity="info"
      data-testid="guide-refined"
      action={<Button size="small" color="inherit" onClick={clear}>{t('guide.refined.original')}</Button>}
    >
      <AlertTitle>{issue ? t('guide.refined.communityTitle', { issue }) : t('guide.refined.title', { n: refined.attempt })}</AlertTitle>
      {t(issue ? 'guide.refined.communityText' : 'guide.refined.text', { dist: refined.dist })}
    </Alert>
  )
}
