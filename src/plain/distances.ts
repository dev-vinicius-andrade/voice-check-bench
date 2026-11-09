// Everyday comparisons for the guided distances (SPEC "Plain language (v0.5)"). Pure.
import type { Msg } from './types'

const EVERYDAY: Record<string, string> = {
  '2 cm': 'finger',
  '8 cm': 'fist',
  '15 cm': 'hand',
}

/** '2 cm' → about a finger's width · '8 cm' → about one fist · '15 cm' → about an open hand; any other value is echoed. */
export function everydayDistance(dist: string): Msg {
  const id = EVERYDAY[dist.trim()]
  return id ? { key: `plain.distance.${id}` } : { key: 'plain.distance.other', params: { dist } }
}

/** Centimetres in a distance label like "8 cm"; null when missing or unparseable. */
export function distanceCm(dist: string | null | undefined): number | null {
  if (!dist) return null
  const m = /^\s*(\d+(?:\.\d+)?)\s*cm\s*$/i.exec(dist)
  return m ? Number(m[1]) : null
}
