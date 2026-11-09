// The three everyday ratings: background noise, your volume, sound of your voice (SPEC "Plain language (v0.5)"). Pure.
import { deviations } from '../audio/reference'
import type { Analysis, NoiseKind, Status } from '../types'
import { LEVEL_HI, LEVEL_LO } from './score'
import type { Msg, Rating, RatingId } from './types'

export type VoiceLabel = 'natural' | 'boomy' | 'boxy' | 'hollow' | 'muffled' | 'harsh' | 'sharpS' | 'dull' | 'thin'
export type VolumeLabel = 'good' | 'tooQuiet' | 'tooLoud' | 'distorting'

/** Harsh S peaks (same threshold as the 'harsh' check). */
export const HARSH_S_P95 = -6

/**
 * Noise wording: quiet when SNR ≥ 30; otherwise the noise kind, and 'broadband' when the kind is
 * missing or says quiet (very low floor but the voice is low too, so the room is still audible).
 */
export function noiseWording(a: Analysis): NoiseKind {
  if (a.snr >= 30) return 'quiet'
  const kind = (a.noiseKind as NoiseKind | null | undefined) ?? null
  return kind === null || kind === 'quiet' ? 'broadband' : kind
}

export function noiseRating(a: Analysis): Rating {
  const snr = a.snr
  const [status, label]: [Status, string] = snr >= 30 ? ['good', 'quiet'] : snr >= 20 ? ['warn', 'noticeable'] : ['bad', 'loud']
  return {
    id: 'noise',
    status,
    label: { key: `plain.rating.noise.label.${label}` },
    explain: { key: `plain.rating.noise.explain.${noiseWording(a)}` },
  }
}

/** Volume from the level and peaks checks: clipping wins, then the speech median, then peaks near the ceiling. */
export function volumeState(a: Analysis): { status: Status; label: VolumeLabel } {
  if (a.clip > 0) return { status: 'bad', label: 'distorting' }
  const v = a.speechMed
  if (v < LEVEL_LO) return { status: v >= -32 ? 'warn' : 'bad', label: 'tooQuiet' }
  if (v > LEVEL_HI) return { status: v <= -12 ? 'warn' : 'bad', label: 'tooLoud' }
  if (a.peak > -1) return { status: 'warn', label: 'tooLoud' }
  return { status: 'good', label: 'good' }
}

export function volumeRating(a: Analysis): Rating {
  const { status, label } = volumeState(a)
  return {
    id: 'volume',
    status,
    label: { key: `plain.rating.volume.label.${label}` },
    explain: { key: `plain.rating.volume.explain.${label}` },
  }
}

/** Label for band i (1..8) deviating in the given direction. */
function bandLabel(i: number, high: boolean): VoiceLabel {
  if (i <= 2) return high ? 'boomy' : 'thin'
  if (i <= 4) return high ? 'boxy' : 'hollow'
  if (i <= 6) return high ? 'harsh' : 'muffled'
  if (i === 7) return high ? 'sharpS' : 'dull'
  return high ? 'harsh' : 'dull'
}

/** Largest |deviation| over bands 1..8 decides; ≤ 3 dB is natural unless S peaks are harsh. */
export function voiceState(a: Analysis): { status: Status; label: VoiceLabel; strength: 'mild' | 'strong' | null; dev: number } {
  const dv = deviations(a.rel)
  let wi = -1
  for (let i = 1; i <= 8; i++) {
    if (!Number.isFinite(dv[i])) continue
    if (wi < 0 || Math.abs(dv[i]) > Math.abs(dv[wi])) wi = i
  }
  const dev = wi < 0 ? 0 : dv[wi]
  const mag = Math.abs(dev)
  if (mag <= 3) {
    if (a.sibP95 > HARSH_S_P95) return { status: 'warn', label: 'sharpS', strength: 'mild', dev }
    return { status: 'good', label: 'natural', strength: null, dev }
  }
  const strong = mag > 6
  return { status: strong ? 'bad' : 'warn', label: bandLabel(wi, dev > 0), strength: strong ? 'strong' : 'mild', dev }
}

export function voiceRating(a: Analysis): Rating {
  const { status, label, strength } = voiceState(a)
  return {
    id: 'voice',
    status,
    label: { key: strength ? `plain.rating.voice.label.${strength}.${label}` : 'plain.rating.voice.label.natural' },
    explain: { key: `plain.rating.voice.explain.${label}` },
  }
}

/** Card title for a rating ("Background noise", "Your volume", "Sound of your voice"). */
export const ratingTitle = (id: RatingId): Msg => ({ key: `plain.rating.${id}.title` })

export function plainRatings(a: Analysis): Rating[] {
  return [noiseRating(a), volumeRating(a), voiceRating(a)]
}
