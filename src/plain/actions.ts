// "What to do next": up to 3 concrete actions, biggest impact first (SPEC "Plain language (v0.5)"). Pure.
import type { Analysis, MicProfile } from '../types'
import { distanceCm } from './distances'
import { volumeState, voiceState } from './ratings'
import { penalties, strongestHum } from './score'
import type { Action, Msg } from './types'

export interface ActionContext {
  mic: MicProfile
  /** Best control distance of the session ("8 cm"), when known. */
  bestDist?: string | null
  /** Distance of the analysed take ("15 cm"); null for free or processed takes. */
  currentDist?: string | null
  /** True when suggested settings exist (the "ready-made settings" actions need them). */
  hasSuggestion: boolean
}

export const MAX_ACTIONS = 3
/** Noisy room for advice: SNR below this. */
export const NOISY_SNR = 25
/** Mains hum at or above this many dB gets the USB-port action. */
export const HUM_ACTION_DB = 12
/** "One fist" target for the move-closer action, cm. */
export const FIST_CM = 8
/** Shares of the noise penalty for the secondary noise actions (placement and noise reduction get all of it). */
const MOVE_CLOSER_SHARE = 0.8
const FANS_SHARE = 0.6
/** Smallest impact of an action for a flagged problem whose score penalty is zero (e.g. peaks near the ceiling). */
const MIN_IMPACT = 1
/** Tone penalty from which the ready-made EQ settings are offered. */
const EQ_MIN_PENALTY = 8

const placementKey = (m: MicProfile): string =>
  m.pattern === 'cardioid' || m.pattern === 'supercardioid' ? m.pattern : 'other'

const speakIntoKey = (m: MicProfile): string => (m.address === 'end' || m.address === 'side' ? m.address : 'unknown')

const msg = (key: string, params?: Msg['params']): Msg => (params ? { key: `plain.action.${key}`, params } : { key: `plain.action.${key}` })

/** Free before paid on equal impact; otherwise the order the actions were found in. */
export function rankActions(actions: readonly Action[], max = MAX_ACTIONS): Action[] {
  const seen = new Set<string>()
  const unique = actions.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)))
  return unique
    .map((x, i) => ({ x, i }))
    .sort((p, q) => q.x.impact - p.x.impact || (p.x.cost === q.x.cost ? 0 : p.x.cost === 'free' ? -1 : 1) || p.i - q.i)
    .slice(0, max)
    .map(({ x }) => x)
}

export function nextActions(a: Analysis, ctx: ActionContext): Action[] {
  const p = penalties(a)
  const voice = voiceState(a)
  const volume = volumeState(a)
  const out: Action[] = []

  // noisy room
  if (a.snr < NOISY_SNR) {
    out.push({ id: 'placement', text: msg(`placement.${placementKey(ctx.mic)}`), cost: 'free', impact: p.noise, how: 'placement' })
  }
  if (strongestHum(a) >= HUM_ACTION_DB) {
    out.push({ id: 'usbPort', text: msg('usbPort'), cost: 'free', impact: p.noise })
  }
  if (a.snr < NOISY_SNR) {
    // never "move closer" while also telling a boomy voice to back off
    const at = distanceCm(ctx.currentDist ?? ctx.bestDist)
    if ((at === null || at > FIST_CM) && voice.label !== 'boomy') {
      out.push({ id: 'moveCloser', text: msg('moveCloser', { cm: FIST_CM }), cost: 'free', impact: p.noise * MOVE_CLOSER_SHARE, how: 'placement' })
    }
    out.push({ id: 'fans', text: msg('fans'), cost: 'free', impact: p.noise * FANS_SHARE })
    if (ctx.hasSuggestion) {
      out.push({ id: 'noiseReduction', text: msg('noiseReduction'), cost: 'minutes', impact: p.noise, how: 'settings' })
    }
  }

  // volume
  if (volume.label !== 'good') {
    const up = volume.label === 'tooQuiet'
    out.push({ id: up ? 'gainUp' : 'gainDown', text: msg(up ? 'gainUp' : 'gainDown'), cost: 'free', impact: Math.max(p.level, MIN_IMPACT), how: 'gain' })
  }

  // sound of the voice
  const toneImpact = Math.max(p.tone, MIN_IMPACT)
  if (voice.label === 'boomy') out.push({ id: 'backOff', text: msg('backOff'), cost: 'free', impact: toneImpact, how: 'placement' })
  if (voice.label === 'muffled') out.push({ id: 'speakInto', text: msg(`speakInto.${speakIntoKey(ctx.mic)}`), cost: 'free', impact: toneImpact, how: 'placement' })
  if (voice.label === 'sharpS') out.push({ id: 'angleMic', text: msg('angleMic'), cost: 'free', impact: toneImpact, how: 'placement' })
  if (p.tone >= EQ_MIN_PENALTY && ctx.hasSuggestion) {
    out.push({ id: 'eqSettings', text: msg('eqSettings'), cost: 'minutes', impact: p.tone, how: 'settings' })
  }

  return rankActions(out.filter((x) => x.impact > 0))
}
