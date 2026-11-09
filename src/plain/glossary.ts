// Plain-language glossary: one sentence + an everyday analogy per term (SPEC "Plain language (v0.5)"). Pure.
import type { Msg } from './types'

export const GLOSSARY_IDS = [
  'gain', 'noise', 'snr', 'db', 'eq', 'noiseReduction', 'compressor', 'gate', 'sibilance', 'proximityEffect', 'cardioid',
] as const

export type GlossaryId = (typeof GLOSSARY_IDS)[number]

export interface GlossaryEntry {
  id: GlossaryId
  term: Msg
  meaning: Msg
  analogy: Msg
}

export const GLOSSARY: GlossaryEntry[] = GLOSSARY_IDS.map((id) => ({
  id,
  term: { key: `plain.glossary.${id}.term` },
  meaning: { key: `plain.glossary.${id}.meaning` },
  analogy: { key: `plain.glossary.${id}.analogy` },
}))

/** Glossary entry by id, for `<Term id>`. */
export const glossaryEntry = (id: GlossaryId): GlossaryEntry => GLOSSARY.find((e) => e.id === id) as GlossaryEntry
