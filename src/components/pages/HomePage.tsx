import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { loadDemoSession } from '../../demo/demoSession'
import { HomeFeatures } from './HomeFeatures'
import { HomeSteps } from './HomeSteps'
import { PageColumn, PageHead, StartButton } from './PageLayout'

/** Landing page: hero, the four steps, features and the compatibility line. */
export function HomePage() {
  const { t } = useTranslation()
  return (
    <PageColumn>
      <div className="grid gap-6">
        <PageHead
          overline={t('pages.home.overline')}
          first={t('pages.home.headFirst')}
          second={t('pages.home.headSecond')}
          lead={t('pages.home.lead')}
        />
        <div className="flex flex-wrap items-center justify-center gap-3">
          <StartButton />
          <Button variant="text" size="large" onClick={() => loadDemoSession()}>
            {t('pages.home.demo')}
          </Button>
        </div>
      </div>
      <HomeSteps />
      <HomeFeatures />
      <Typography variant="body2" color="text.secondary" align="center">
        {t('pages.home.compat')}
      </Typography>
    </PageColumn>
  )
}
