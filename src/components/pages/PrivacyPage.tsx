import Link from '@mui/material/Link'
import { Trans, useTranslation } from 'react-i18next'
import { SITE } from '../../site'
import { BulletList } from './DefList'
import { PRIVACY_LOCAL } from './howItWorksData'
import { Code, PageColumn, PageHead, PageSection, Para } from './PageLayout'

/** Privacy: what stays local, what a shared result contains, how to remove it, no tracking, the Wave Link tool. */
export function PrivacyPage() {
  const { t } = useTranslation()
  const email = SITE.author.email
  return (
    <PageColumn>
      <PageHead first={t('pages.privacy.headFirst')} second={t('pages.privacy.headSecond')} lead={t('pages.privacy.lead')} />
      <PageSection title={t('pages.privacy.local.title')}>
        <BulletList
          items={PRIVACY_LOCAL.map((id) => (
            <Trans key={id} i18nKey={`pages.privacy.local.${id}`} components={{ b: <b /> }} />
          ))}
        />
      </PageSection>
      <PageSection title={t('pages.privacy.share.title')}>
        <Para>{t('pages.privacy.share.text')}</Para>
      </PageSection>
      <PageSection title={t('pages.privacy.remove.title')}>
        <Para>
          <Trans i18nKey="pages.privacy.remove.text" values={{ email }} components={{ link: <Link href={`mailto:${email}`} /> }} />
        </Para>
      </PageSection>
      <PageSection title={t('pages.privacy.tracking.title')}>
        <Para>{t('pages.privacy.tracking.text')}</Para>
      </PageSection>
      <PageSection title={t('pages.privacy.tool.title')}>
        <Para>
          <Trans i18nKey="pages.privacy.tool.text" values={{ file: 'tools/apply-reaplugs.py' }} components={{ code: <Code /> }} />
        </Para>
      </PageSection>
    </PageColumn>
  )
}
