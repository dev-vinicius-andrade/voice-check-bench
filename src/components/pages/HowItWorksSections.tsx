import { Trans, useTranslation } from 'react-i18next'
import { BulletList } from './DefList'
import { APPLY, TAKES } from './howItWorksData'
import { Code, PageSection, Para } from './PageLayout'

const APPLY_CMD = 'python tools/apply-reaplugs.py reaplugs-settings.json --write'

/** "The four takes": why three mic-only distances, why the quiet start, why a take with effects. */
export function HowTakesSection() {
  const { t } = useTranslation()
  return (
    <PageSection title={t('pages.how.takes.title')}>
      <Para>{t('pages.how.takes.intro')}</Para>
      <BulletList items={TAKES.map((id) => <Trans key={id} i18nKey={`pages.how.takes.${id}`} components={{ b: <b /> }} />)} />
    </PageSection>
  )
}

/** "Using the settings": by hand or with the Wave Link tool. */
export function HowApplySection() {
  const { t } = useTranslation()
  return (
    <PageSection title={t('pages.how.apply.title')}>
      <Para>{t('pages.how.apply.intro')}</Para>
      <BulletList
        items={APPLY.map((id) => (
          <Trans
            key={id}
            i18nKey={`pages.how.apply.${id}`}
            values={{ cmd: APPLY_CMD }}
            components={{ b: <b />, code: <Code /> }}
          />
        ))}
      />
    </PageSection>
  )
}
