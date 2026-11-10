// Shape validation of applied settings (SPEC "Refinement loop (v1.1)"): localStorage 'vcb-applied' and processed takes.
// Rebuilt from known keys only; anything malformed reads as "nothing applied".
import { parseSuggestion } from '../profiles/validate'
import type { AppliedSettings } from '../types'

const ROUTES: readonly AppliedSettings['noiseRemoval'][] = ['reafir', 'ai-elgato', 'ai-nvidia', 'none']
const MAX_ATTEMPT = 1000

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const shortStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim() !== '' && v.length <= max

/** Valid applied settings rebuilt from known keys, or null. */
export function parseApplied(v: unknown): AppliedSettings | null {
  if (!isObject(v)) return null
  if (!shortStr(v.id, 100) || !shortStr(v.date, 40) || !Number.isFinite(Date.parse(v.date))) return null
  if (!shortStr(v.dist, 40)) return null
  const noiseRemoval = ROUTES.find((r) => r === v.noiseRemoval)
  if (!noiseRemoval) return null
  const attempt = v.attempt
  if (typeof attempt !== 'number' || !Number.isInteger(attempt) || attempt < 1 || attempt > MAX_ATTEMPT) return null
  let settings: AppliedSettings['settings']
  try {
    settings = parseSuggestion(v.settings)
  } catch {
    return null
  }
  return { id: v.id, date: v.date, settings, noiseRemoval, dist: v.dist, attempt }
}
