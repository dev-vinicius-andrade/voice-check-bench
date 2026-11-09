import Link from '@mui/material/Link'
import { SITE } from '../../site'
import { BulletList } from './DefList'
import { Code, PageColumn, PageHead, PageSection, Para } from './PageLayout'

/** Privacy: what stays local, what a shared result contains, how to remove it, no tracking, the Wave Link tool. */
export function PrivacyPage() {
  return (
    <PageColumn>
      <PageHead
        first="Your audio"
        second="stays with you"
        lead="Everything is analysed in your browser. Nothing is uploaded unless you choose to share a summary."
      />
      <PageSection title="On your computer">
        <BulletList
          items={[
            "Your recordings and their analysis are stored in this browser's IndexedDB.",
            'Your preferences (mic profile, chosen inputs, last screen) are stored in localStorage.',
            'Nothing is uploaded to any server.',
            <>
              <b>Delete all</b> on the Results page removes every take from this browser.
            </>,
          ]}
        />
      </PageSection>
      <PageSection title="When you share">
        <Para>
          Sharing is opt-in. It opens a public GitHub issue under your own account with your mic profile, the analysis
          numbers and the suggested settings. It has no audio, no device names and no dates, and you review it before
          posting.
        </Para>
      </PageSection>
      <PageSection title="Removing a shared result">
        <Para>
          Close or edit the issue on GitHub, or email{' '}
          <Link href={`mailto:${SITE.author.email}`}>{SITE.author.email}</Link> to ask for it to be removed from the community stats.
        </Para>
      </PageSection>
      <PageSection title="No tracking">
        <Para>No analytics, no cookies, no ads.</Para>
      </PageSection>
      <PageSection title="The Wave Link tool">
        <Para>
          <Code>tools/apply-reaplugs.py</Code> runs locally on your computer. It reads and writes only Wave Link's
          Settings.json, and saves a backup of it before writing.
        </Para>
      </PageSection>
    </PageColumn>
  )
}
