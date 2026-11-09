// Guided session definition ported 1:1 from the prototype (docs/prototype/voice-check.html). Pure.
import type { DeviceKind, StepDef } from '../types'

/** `{d}` in title/head/lead is replaced by the processed-take distance (see fillDistance). */
export const STEPS: StepDef[] = [
  { key: 'c2', kind: 'Control test', cm: 2, dist: '2 cm', dev: 'raw', title: 'Control · 2 cm · raw', head: 'Record at 2 cm, raw mic', lead: 'Mouth about 2 cm from the grille, speaking straight into the top of the K688. This shows how much bass the mic adds up close.' },
  { key: 'c8', kind: 'Control test', cm: 8, dist: '8 cm', dev: 'raw', title: 'Control · 8 cm · raw', head: 'Record at 8 cm, raw mic', lead: 'About a fist between your mouth and the mic, still straight into the top. Same voice volume as before.' },
  { key: 'c15', kind: 'Control test', cm: 15, dist: '15 cm', dev: 'raw', title: 'Control · 15 cm · raw', head: 'Record at 15 cm, raw mic', lead: "An open hand's length away, straight into the top. Same voice volume as before." },
  { key: 'fx', kind: 'With your effects', cm: null, dist: null, dev: 'fx', title: 'Processed · {d} · Record Mix', head: 'Record it again, with your effects', lead: 'Same text at your best distance: {d}. This take goes through the Record Mix, so it shows what your effects add.' },
]

/** Auto-pick an input for each device kind by its label. */
export const DEV_MATCH: Record<DeviceKind, (label: string) => boolean> = {
  raw: (l) => /mic in|wave:?\s*xlr/i.test(l) && !/virtual/i.test(l),
  fx: (l) => /record mix/i.test(l),
}

/** Expected device name per kind, shown before the mic is enabled. */
export const DEV_NAME: Record<DeviceKind, string> = {
  raw: 'Elgato Wave:XLR (Mic In)',
  fx: 'Elgato Virtual Audio (Record Mix)',
}

/** Replace every `{d}` placeholder with the distance. */
export const fillDistance = (text: string, dist: string): string => text.replaceAll('{d}', dist)
