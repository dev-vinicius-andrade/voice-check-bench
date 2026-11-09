import { useTranslation } from 'react-i18next'
import { BulletList, DefList } from './DefList'
import { HowApplySection, HowTakesSection } from './HowItWorksSections'
import { CHAIN, MEASURES, ROOM_TIPS } from './howItWorksData'
import { PageColumn, PageCta, PageHead, PageSection, Para } from './PageLayout'

/** "How it works": the takes, what is measured, the suggested chain, applying it and tips for noisy rooms. */
export function HowItWorksPage() {
  const { t } = useTranslation()
  const measures = MEASURES.map((id) => ({ term: t(`pages.how.measures.${id}.term`), def: t(`pages.how.measures.${id}.def`) }))
  const chain = CHAIN.map((name) => ({ term: `${name} — ${t(`pages.how.chain.${name}.role`)}`, def: t(`pages.how.chain.${name}.def`) }))
  return (
    <PageColumn>
      <PageHead first={t('pages.how.headFirst')} second={t('pages.how.headSecond')} lead={t('pages.how.lead')} />
      <HowTakesSection />
      <PageSection title={t('pages.how.measures.title')}>
        <DefList items={measures} />
      </PageSection>
      <PageSection title={t('pages.how.chain.title')}>
        <Para>{t('pages.how.chain.intro')}</Para>
        <DefList items={chain} />
      </PageSection>
      <HowApplySection />
      <PageSection title={t('pages.how.tips.title')}>
        <BulletList items={ROOM_TIPS.map((id) => t(`pages.how.tips.${id}`))} />
      </PageSection>
      <PageCta text={t('pages.how.cta')} />
    </PageColumn>
  )
}
