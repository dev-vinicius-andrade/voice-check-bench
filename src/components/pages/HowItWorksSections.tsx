import { BulletList } from './DefList'
import { Code, PageSection, Para } from './PageLayout'

/** "The four takes": why three raw distances, why the silence, why a processed take. */
export function HowTakesSection() {
  return (
    <PageSection title="The four takes">
      <Para>You read the same short text four times. Each take starts with 3 s of silence.</Para>
      <BulletList
        items={[
          <>
            <b>Three raw takes at 2, 8 and 15 cm.</b> Close up, the proximity effect adds bass; further away, the mic
            hears more of the room. Comparing them shows which distance gives you the clearest voice.
          </>,
          <>
            <b>3 s of silence first.</b> That silence measures the room on its own: its level, fan tones and which bands
            it fills.
          </>,
          <>
            <b>One take through your effects.</b> Recorded at your best distance, it is compared with the raw take so you
            see what your current chain does, before vs after.
          </>,
        ]}
      />
    </PageSection>
  )
}

/** "Applying the settings": by hand or with the Wave Link tool. */
export function HowApplySection() {
  return (
    <PageSection title="Applying the settings">
      <Para>Copy the suggested values from the results page and use either way:</Para>
      <BulletList
        items={[
          <>
            <b>By hand:</b> open each plugin window in Wave Link and type in the values.
          </>,
          <>
            <b>With the tool:</b> download the JSON from Results, quit Wave Link from the tray, then run{' '}
            <Code>python tools/apply-reaplugs.py reaplugs-settings.json --write</Code>. It backs up Settings.json first.
          </>,
          <>
            <b>ReaFIR is always set up by hand:</b> its noise profile has to be captured in your room, from a few seconds
            of silence.
          </>,
        ]}
      />
    </PageSection>
  )
}
