// Profile contract (SPEC "Profiles" + revision). Owned by the orchestrator.
import type { DeviceChoice, MicProfile, VoiceGoal } from '../types'
import type { SuggestionJson } from '../settings/suggest'

export type ProfileHost = 'wavelink' | 'obs' | 'apps' | 'nvidia' | null

export interface ProfileValidation {
  rawScore: number
  fxScore: number
  snrGain: number
  regressions: string[]
  date: string
}

export interface Profile {
  version: 1
  id: string
  name: string
  created: string
  updated: string
  mic: MicProfile
  host: ProfileHost
  dist: string
  goal: VoiceGoal
  mains: 50 | 60 | 'auto'
  suggestion: SuggestionJson
  /** Exact Wave Link plugin states captured from an uploaded Settings.json (name → base64 ParameterState), incl. a configured ReaFIR. */
  wavelinkStates?: Record<string, string>
  devices?: DeviceChoice
  validation: ProfileValidation | null
  active?: boolean
}

/** fxScore ≥ rawScore + 5 and no over-processing regressions. */
export const PROFILE_MIN_GAIN = 5
