// Profiles from a session, validation rule, export/import, and the Wave Link plan of a profile (SPEC "Profiles
// (v1.0)" + "Profiles revision — Wave Link file round trip"). Framework-free.
import { compareProcessed } from '../plain/compare'
import { clarityScore } from '../plain/score'
import type { SuggestionJson } from '../settings/suggest'
import type { Analysis, DeviceChoice, MicProfile, VoiceGoal, VoiceStyle } from '../types'
import { micInputKey } from '../wavelink/codec'
import { REAPLUG_NAMES, canonicalName } from '../wavelink/plugins'
import type { WlApplyPlan, WlFile } from '../wavelink/types'
import { PROFILE_MIN_GAIN, type Profile, type ProfileHost, type ProfileValidation } from './types'
import { MAX_PROFILE_TEXT, parseProfile } from './validate'

/** Host names for profile names (product names, never translated). */
export const HOST_NAMES: Record<NonNullable<ProfileHost>, string> = {
  wavelink: 'Wave Link',
  obs: 'OBS Studio',
  apps: 'Calls',
  nvidia: 'NVIDIA Broadcast',
}
const STYLE_NAMES: Record<VoiceStyle, string> = { natural: 'Natural', warm: 'Warm', clear: 'Clear', bright: 'Bright' }

/** "<host> · <style>", e.g. "Wave Link · Warm"; just the style without a host. `styleLabel` overrides the English style name. */
export function suggestProfileName(host: ProfileHost, style: VoiceStyle, styleLabel?: string): string {
  const s = styleLabel ?? STYLE_NAMES[style]
  return host ? `${HOST_NAMES[host]} · ${s}` : s
}

/** New unique profile id (crypto.randomUUID when available, which needs a secure context). */
export function newProfileId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch {
    // fall through
  }
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Raw control vs processed take: clarity scores (processed scored against its raw control), SNR gain and the
 * over-processing regressions. Null without both takes.
 */
export function sessionValidation(raw: Analysis | null, fx: Analysis | null, goal: VoiceGoal, now: Date = new Date()): ProfileValidation | null {
  if (!raw || !fx) return null
  const gain = fx.snr - raw.snr
  return {
    rawScore: clarityScore(raw, { goal }).score,
    fxScore: clarityScore(fx, { raw, goal }).score,
    snrGain: Number.isFinite(gain) ? Math.round(gain * 10) / 10 : 0,
    regressions: compareProcessed(raw, fx).regressions,
    date: now.toISOString(),
  }
}

/** A profile may be saved as validated only when processing beats raw by PROFILE_MIN_GAIN points with no regressions. */
export const canValidate = (v: ProfileValidation | null): boolean =>
  !!v && v.fxScore >= v.rawScore + PROFILE_MIN_GAIN && v.regressions.length === 0

export interface SessionProfileInput {
  /** Defaults to suggestProfileName(host, goal.style). */
  name?: string
  mic: MicProfile
  host: ProfileHost
  dist: string
  goal: VoiceGoal
  mains: 50 | 60 | 'auto'
  suggestion: SuggestionJson
  devices?: DeviceChoice
  /** From captureStates() of an uploaded Settings.json. */
  wavelinkStates?: Record<string, string>
  /** Raw control and processed take of the session (null when absent). */
  raw: Analysis | null
  fx: Analysis | null
  id?: string
  now?: Date
}

/** A new profile. `validation` is filled only when canValidate passes; otherwise it is a "Not validated yet" draft (null). */
export function profileFromSession(input: SessionProfileInput): Profile {
  const now = input.now ?? new Date()
  const v = sessionValidation(input.raw, input.fx, input.goal, now)
  const stamp = now.toISOString()
  return {
    version: 1,
    id: input.id ?? newProfileId(),
    name: (input.name ?? '').trim() || suggestProfileName(input.host, input.goal.style),
    created: stamp,
    updated: stamp,
    mic: { ...input.mic },
    host: input.host,
    dist: input.dist,
    goal: { style: input.goal.style, perceived: [...input.goal.perceived] },
    mains: input.mains,
    suggestion: input.suggestion,
    ...(input.wavelinkStates && Object.keys(input.wavelinkStates).length ? { wavelinkStates: { ...input.wavelinkStates } } : {}),
    ...(input.devices ? { devices: { ...input.devices } } : {}),
    validation: v && canValidate(v) ? v : null,
  }
}

/** Copy under a new id and name (not active). */
export function duplicateProfile(p: Profile, name: string, now: Date = new Date()): Profile {
  const { active: _drop, ...rest } = p
  void _drop
  const stamp = now.toISOString()
  return { ...rest, id: newProfileId(), name: name.trim() || p.name, created: stamp, updated: stamp }
}

/** JSON file text (version 1). The local active flag is not exported; non-finite numbers become null. */
export function exportProfile(p: Profile): string {
  const { active: _drop, ...rest } = p
  void _drop
  return JSON.stringify(rest, null, 2)
}

/** Profile from an imported file, rebuilt from known keys only; null when anything is missing, wrong or out of range. */
export function importProfile(text: string): Profile | null {
  if (typeof text !== 'string' || text.length > MAX_PROFILE_TEXT) return null
  try {
    return parseProfile(JSON.parse(text.replace(/^\uFEFF/, '')) as unknown)
  } catch {
    return null
  }
}

/** ParameterState of the ReaPlugs (ReaFIR, ReaGate, ReaEQ, ReaComp) on the input, by canonical name. */
export function captureStates(file: WlFile, inputKey: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of file.inputs.find((i) => i.key === inputKey)?.plugins ?? []) {
    const name = canonicalName(p.name)
    if (REAPLUG_NAMES.includes(name) && p.parameterState) out[name] = p.parameterState
  }
  return out
}

/** The Wave Link plan of a profile: its suggestion values, then its exact plugin states restored. */
export function profilePlan(p: Profile, file: WlFile, inputKey: string | null = micInputKey(file)): WlApplyPlan {
  const states = p.wavelinkStates && Object.keys(p.wavelinkStates).length ? { restoreStates: { ...p.wavelinkStates } } : {}
  return { inputKey: inputKey ?? '', suggestion: p.suggestion, ...states }
}
