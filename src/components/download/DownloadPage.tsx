import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Link from '@mui/material/Link'
import Typography from '@mui/material/Typography'
import { Trans, useTranslation } from 'react-i18next'
import { RELEASES_PAGE, pickLatest } from '../../downloads/releases'
import { screenToHash } from '../../hooks/useHashRoute'
import { PageColumn, PageHead, PageSection, Para } from '../pages/PageLayout'
import { LatestRelease } from './LatestRelease'
import { OtherReleases } from './OtherReleases'
import { useReleases } from './useReleases'

const INSTALL_STEPS = ['run', 'smartscreen', 'open'] as const

/** Latest release card (or loading / fallback), then the other versions while there are any. */
function ReleaseList() {
  const { t } = useTranslation()
  const state = useReleases()
  if (state.status === 'loading')
    return (
      <div className="flex items-center justify-center gap-3 py-10" role="status">
        <CircularProgress size={20} />
        <Typography color="text.secondary">{t('pages.download.loading')}</Typography>
      </div>
    )
  if (state.status === 'unavailable')
    return (
      <Alert
        severity="info"
        variant="outlined"
        action={
          <Button color="inherit" size="small" href={RELEASES_PAGE} target="_blank" rel="noopener noreferrer">
            {t('pages.download.allReleases')}
          </Button>
        }
      >
        {t('pages.download.unavailable')}
      </Alert>
    )
  const latest = pickLatest(state.releases)
  const others = state.releases.filter((r) => r !== latest)
  return (
    <>
      {latest && <LatestRelease release={latest} />}
      {others.length > 0 && (
        <PageSection title={t('pages.download.older.title')}>
          <OtherReleases releases={others} />
        </PageSection>
      )}
    </>
  )
}

/** Download page for the Windows desktop app (SPEC "Distribution"): newest release from GitHub, install and update notes. */
export function DownloadPage() {
  const { t } = useTranslation()
  return (
    <PageColumn>
      <PageHead
        overline={t('pages.download.overline')}
        first={t('pages.download.headFirst')}
        second={t('pages.download.headSecond')}
        lead={t('pages.download.lead')}
      />
      <ReleaseList />
      <PageSection title={t('pages.download.install.title')}>
        <ol className="grid list-decimal gap-2 pl-6">
          {INSTALL_STEPS.map((id) => (
            <Typography key={id} component="li" color="text.secondary" sx={{ lineHeight: 1.7 }}>
              <Trans i18nKey={`pages.download.install.steps.${id}`} components={{ b: <b /> }} />
            </Typography>
          ))}
        </ol>
      </PageSection>
      <PageSection title={t('pages.download.updates.title')}>
        <Para>{t('pages.download.updates.text')}</Para>
      </PageSection>
      <PageSection title={t('pages.download.web.title')}>
        <Para>
          {t('pages.download.web.text')} <Link href={screenToHash('setup')}>{t('common.actions.startCheck')}</Link>
        </Para>
      </PageSection>
      <Link href={RELEASES_PAGE} target="_blank" rel="noopener noreferrer" variant="body2" sx={{ justifySelf: 'center' }}>
        {t('pages.download.allReleases')}
      </Link>
    </PageColumn>
  )
}
