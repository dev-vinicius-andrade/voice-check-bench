// Plain-language engine contract (SPEC "Plain language (v0.5)"). Framework-free: modules return message keys, the UI translates them.
import type { Status } from '../types'

/**
 * A translatable message: a dotted key from the root of the locale file (e.g. `plain.score.clear`)
 * plus interpolation params (`{{name}}` in the string).
 */
export interface Msg {
  key: string
  params?: Record<string, string | number>
}

/** The biggest problem behind the clarity score, or 'none' when no penalty reaches 8. */
export type MainIssue = 'overprocessed' | 'noise' | 'level' | 'tone' | 'none'

export interface ScorePenalties {
  noise: number
  level: number
  tone: number
  consistency: number
  /** Over-processing (v0.8): digital silence / gate flipping, plus 10 per regression against the raw take. */
  overprocessed: number
}

export interface ClarityScore {
  /** 0..100, rounded. */
  score: number
  main: MainIssue
  headline: Msg
  explain: Msg
  penalties: ScorePenalties
}

export type RatingId = 'noise' | 'volume' | 'voice'

/** One of the three everyday ratings (background noise, your volume, sound of your voice). */
export interface Rating {
  id: RatingId
  status: Status
  label: Msg
  explain: Msg
}

export type ActionCost = 'free' | 'minutes'
/** Which "Show me how" panel the action opens. */
export type ActionHow = 'settings' | 'placement' | 'gain'

export type ActionId =
  | 'placement' | 'moveCloser' | 'fans' | 'noiseReduction'
  | 'gainUp' | 'gainDown'
  | 'backOff' | 'speakInto' | 'angleMic' | 'eqSettings'
  | 'usbPort'
  | 'noiseRemovalDown' | 'compWet'

export interface Action {
  id: ActionId
  text: Msg
  cost: ActionCost
  /** Score points this action addresses; actions are sorted by it, highest first. */
  impact: number
  how?: ActionHow
}
