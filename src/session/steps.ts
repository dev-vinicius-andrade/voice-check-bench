// Guided session definition ported 1:1 from the prototype (docs/prototype/voice-check.html). Pure.
import type { DeviceKind, StepDef, StepKey } from '../types'

/** `{d}` in title/head/lead is replaced by the processed-take distance (see fillDistance). English data only; the UI uses stepText(). */
export const STEPS: StepDef[] = [
  { key: 'c2', kind: 'Control test', cm: 2, dist: '2 cm', dev: 'raw', title: 'Control · 2 cm · raw', head: 'Record at 2 cm, raw mic', lead: 'Mouth about 2 cm from the mic, speaking on-axis (straight into the capsule). This shows how much bass the mic adds up close.' },
  { key: 'c8', kind: 'Control test', cm: 8, dist: '8 cm', dev: 'raw', title: 'Control · 8 cm · raw', head: 'Record at 8 cm, raw mic', lead: 'About a fist between your mouth and the mic, still speaking on-axis. Same voice volume as before.' },
  { key: 'c15', kind: 'Control test', cm: 15, dist: '15 cm', dev: 'raw', title: 'Control · 15 cm · raw', head: 'Record at 15 cm, raw mic', lead: "An open hand's length away, still on-axis. Same voice volume as before." },
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

// UI text. `title`/`head`/`lead`/`kind` above stay as locale-neutral data (title names stored takes and exports);
// screens show the translated copy from `wizard.steps.<key>.*` instead.
export type StepPart = 'kind' | 'title' | 'head1' | 'head2' | 'lead'
export const STEP_PARTS: readonly StepPart[] = ['kind', 'title', 'head1', 'head2', 'lead']

/** i18n key of one part of a step's on-screen copy. */
export const stepKey = (st: Pick<StepDef, 'key'>, part: StepPart): string => `wizard.steps.${st.key}.${part}`

/** A translate function (i18next `t`), kept structural so this module stays framework-free. */
export type Translate = (key: string, params?: Record<string, string | number>) => string

/** Translated copy of a step; `dist` is the already formatted distance (the step's own, or the best one for fx). */
export function stepText(st: Pick<StepDef, 'key'>, t: Translate, dist: string): Record<StepPart, string> {
  const out = {} as Record<StepPart, string>
  for (const part of STEP_PARTS) out[part] = t(stepKey(st, part), { dist })
  return out
}

/** The step of a guided take; undefined for a free take. */
export const stepOf = (key: StepKey | null): StepDef | undefined => STEPS.find((s) => s.key === key)

/**
 * Distance a guided take was recorded at: the step's own, or for the processed take the one filled into its
 * stored name ("Processed · 8 cm · Record Mix" → "8 cm"). Null for free takes or an unrecognised name.
 * The stored name is locale-neutral data; screens show the step copy (stepText) with this distance instead.
 */
export function takeDist(take: { step: StepKey | null; name: string }): string | null {
  const st = stepOf(take.step)
  if (!st) return null
  if (st.dist) return st.dist
  const [pre, post = ''] = st.title.split('{d}')
  const n = take.name
  return n.length > pre.length + post.length && n.startsWith(pre) && n.endsWith(post) ? n.slice(pre.length, n.length - post.length) : null
}
