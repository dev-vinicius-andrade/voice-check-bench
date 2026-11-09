import { BulletList, DefList } from './DefList'
import { HowApplySection, HowTakesSection } from './HowItWorksSections'
import { CHAIN, MEASURES, ROOM_TIPS } from './howItWorksData'
import { PageColumn, PageCta, PageHead, PageSection, Para } from './PageLayout'

/** "How it works": the takes, what is measured, the suggested chain, applying it and tips for bad rooms. */
export function HowItWorksPage() {
  return (
    <PageColumn>
      <PageHead
        first="How it"
        second="works"
        lead="Four short takes of the same text, analysed in your browser. The differences between them show what your mic, your distance and your room do to your voice."
      />
      <HowTakesSection />
      <PageSection title="What we measure">
        <DefList items={MEASURES} />
      </PageSection>
      <PageSection title="The suggested chain">
        <Para>
          The settings are for the free ReaPlugs in Wave Link, in this order. In a quiet room ReaFIR is skipped and the
          chain is ReaGate → ReaEQ → ReaComp.
        </Para>
        <DefList items={CHAIN} />
      </PageSection>
      <HowApplySection />
      <PageSection title="Tips for bad rooms">
        <BulletList items={ROOM_TIPS} />
      </PageSection>
      <PageCta text="Five minutes, four takes, settings you can use today." />
    </PageColumn>
  )
}
