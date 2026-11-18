// What the person's goals mean in numbers. Pure. Every target the tuner aims at and every cap on its moves lives here.
import { PEAK_WARN_DB, TARGET_SPEECH_DB } from '../../audio/diagnose'
import { STYLE_OFFSETS } from '../../audio/reference'
import { GATE_STEP_DB } from '../../plain/refine'
import { SNR_CAP } from '../../plain/score'
import { BY_EAR_DB } from '../../settings/suggest'
import type { VoiceStyle } from '../../types'
import { AMOUNT_STEP_DB, type ProcessingAmount } from '../advice/prefs'
import type { Bother, TuneGoals, TuneUse } from './types'

/** Number of tone bands (BANDS entries: rumble, boom, warmth, mud, body, definition, presence, sibilance, air). */
export const N_BANDS = 9
/** Message key of each band (the band checks' ids). */
export const BAND_KEYS = ['rumble', 'boom', 'warmth', 'mud', 'body', 'definition', 'presence', 'sibilance', 'air'] as const

/** A band this close to the target is fine (the band checks' "good" range), dB. */
export const TONE_TOL_DB = 3
/** A band the person complains about must come this close, on the side they complain about, dB. */
export const TONE_BOTHER_TOL_DB = 1
/** Weight of each band in the tone score: rumble is not EQ'd here, air counts half (little voice up there). */
export const TONE_WEIGHTS: readonly number[] = [0, 1, 1, 1, 1, 1, 1, 1, 0.5]
/** A band the person complains about counts this many times: what they said bothers them comes first. */
export const BOTHER_WEIGHT = 2

/** The tuner leaves this much room under PEAK_WARN_DB when it raises the level, dB. */
export const PEAK_MARGIN_DB = 1
/** "Too quiet" picked: aim this much above the middle of the good range (still inside it), dB. */
export const TOO_QUIET_EXTRA_DB = 2

/** Voice over pause noise the tuner wants: the clarity score stops penalising noise here, dB. */
export const SNR_TARGET_DB = 30
/** Calls: the call app removes noise too, and two removers in a row sound robotic, so less is asked for, dB. */
export const SNR_TARGET_CALLS_DB = 25
/** Level spread that reads as even (the consistency check's good range), dB. */
export const SPREAD_TARGET_DB = 8
/** Recording and calls keep more of the natural dynamics (editing or the call app's own levelling comes after), dB. */
export const SPREAD_TARGET_LOOSE_DB = 10
/** "Uneven volume" picked: this much tighter, dB. */
export const UNEVEN_TIGHTER_DB = 2

/** Largest moves per amount, from where the chain started (all scaled by TuneInput.limit). */
export interface TuneCaps {
  /** Largest move of one EQ gain, dB (the "Your sound" amount step). */
  eqStepDb: number
  /** Sum of all EQ gain moves, dB: three full steps. */
  eqTotalDb: number
  /** One Noise Removal step, and the furthest the strength may end from its start (0..100). */
  nrStep: number
  nrMax: number
  /** Furthest a gate threshold may move, dB. */
  gateDb: number
  /** Highest ratio the tuner sets on a compressor that sits lower. */
  ratio: number
}

const CAPS: Readonly<Record<ProcessingAmount, TuneCaps>> = {
  light: { eqStepDb: AMOUNT_STEP_DB.light, eqTotalDb: 3 * AMOUNT_STEP_DB.light, nrStep: 10, nrMax: 20, gateDb: GATE_STEP_DB / 2, ratio: 2 },
  medium: { eqStepDb: AMOUNT_STEP_DB.medium, eqTotalDb: 3 * AMOUNT_STEP_DB.medium, nrStep: 20, nrMax: 40, gateDb: GATE_STEP_DB, ratio: 3 },
  strong: { eqStepDb: AMOUNT_STEP_DB.strong, eqTotalDb: 3 * AMOUNT_STEP_DB.strong, nrStep: 40, nrMax: 80, gateDb: GATE_STEP_DB * 2, ratio: 4 },
}

export interface TuneTargets {
  style: VoiceStyle
  /** Speech level to reach, dBFS. */
  speechDb: number
  /** Peaks stay under this when the level is raised, dBFS. */
  peakCeilDb: number
  /** Wanted voice over pause noise, dB. */
  snrDb: number
  /** Pauses may drop to digital silence (the person asked for as much removal as possible). */
  allowDeadSilence: boolean
  /** Wanted level spread, dB. */
  spreadDb: number
  /**
   * Tone, per band: `shift` moves the target against a complaint (a band heard as too much is aimed BY_EAR_DB under
   * the style's target, so the correction is justified even when the band measures on target); `tolHigh` / `tolLow`
   * are how far above / below the shifted target the band may sit; `weight` is its share of the tone score
   * (TONE_WEIGHTS, × BOTHER_WEIGHT for a band a complaint points at).
   */
  shift: number[]
  tolHigh: number[]
  tolLow: number[]
  weight: number[]
  caps: TuneCaps
}

/** Bands each complaint points at, and the side: +1 = heard as too much there, −1 = too little (SPEC "Voice goals"). */
const BOTHER_BANDS: Readonly<Partial<Record<Bother, readonly (readonly [band: number, side: 1 | -1])[]>>> = {
  boomy: [[1, 1], [2, 1]],
  thin: [[1, -1], [2, -1]],
  muffled: [[3, 1], [6, -1]],
  harsh: [[6, 1]],
  sharpS: [[7, 1]],
  dull: [[7, -1], [8, -1]],
}

const SNR_BY_USE: Readonly<Record<TuneUse, number>> = { streaming: SNR_TARGET_DB, calls: SNR_TARGET_CALLS_DB, recording: SNR_TARGET_DB }
const SPREAD_BY_USE: Readonly<Record<TuneUse, number>> = { streaming: SPREAD_TARGET_DB, calls: SPREAD_TARGET_LOOSE_DB, recording: SPREAD_TARGET_LOOSE_DB }

/** The style's offsets per band (natural for an unknown style). */
export const styleOffsets = (style: VoiceStyle): readonly number[] => (Object.hasOwn(STYLE_OFFSETS, style) ? STYLE_OFFSETS[style] : STYLE_OFFSETS.natural)

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1)

/**
 * Targets and caps of a run.
 * - use: streaming → SNR 30 dB, spread 8 dB (the audience hears exactly this) · calls → SNR 25 dB, spread 10 dB (the
 *   call app removes noise and levels the voice again) · recording → SNR 30 dB, spread 10 dB, and pauses never drop
 *   to digital silence (it cannot be edited back).
 * - style: the tone target (reference curve + the style's offsets).
 * - bothers: roomNoise → SNR target SNR_CAP (45 dB, where more stops counting); with amount strong (never for
 *   recording) pauses may go dead silent · tooQuiet → speech target +2 dB · unevenVolume → spread target −2 dB and one
 *   more ratio step · boomy / thin / muffled / harsh / sharpS / dull → their bands (BOTHER_BANDS) are aimed BY_EAR_DB
 *   past the style target against the complaint, must come within 1 dB on that side (every other band: 3 dB) and
 *   count double in the tone score.
 *   Opposite complaints on one band cancel the shift and keep the tight tolerance on both sides.
 * - amount (× limit): the caps on every move, counted from where the chain started.
 */
export function targetsOf(goals: TuneGoals, limit = 1): TuneTargets {
  const has = (b: Bother): boolean => goals.bothers.includes(b)
  const k = clamp01(limit)
  const shift = new Array<number>(N_BANDS).fill(0)
  const tolHigh = new Array<number>(N_BANDS).fill(TONE_TOL_DB)
  const tolLow = new Array<number>(N_BANDS).fill(TONE_TOL_DB)
  const weight = [...TONE_WEIGHTS]
  for (const b of new Set(goals.bothers)) {
    for (const [band, side] of BOTHER_BANDS[b] ?? []) {
      weight[band] = TONE_WEIGHTS[band] * BOTHER_WEIGHT
      shift[band] += side * BY_EAR_DB
      if (side > 0) tolHigh[band] = TONE_BOTHER_TOL_DB
      else tolLow[band] = TONE_BOTHER_TOL_DB
    }
  }
  const base = CAPS[goals.amount] ?? CAPS.medium
  const uneven = has('unevenVolume')
  const caps: TuneCaps = {
    eqStepDb: base.eqStepDb * k,
    eqTotalDb: base.eqTotalDb * k,
    nrStep: Math.round(base.nrStep * k),
    nrMax: Math.round(base.nrMax * k),
    gateDb: base.gateDb * k,
    ratio: 1 + (base.ratio + (uneven ? 1 : 0) - 1) * k,
  }
  return {
    style: goals.style,
    speechDb: TARGET_SPEECH_DB + (has('tooQuiet') ? TOO_QUIET_EXTRA_DB : 0),
    peakCeilDb: PEAK_WARN_DB - PEAK_MARGIN_DB,
    snrDb: has('roomNoise') ? SNR_CAP : (SNR_BY_USE[goals.use] ?? SNR_TARGET_DB),
    allowDeadSilence: has('roomNoise') && goals.amount === 'strong' && goals.use !== 'recording',
    spreadDb: (SPREAD_BY_USE[goals.use] ?? SPREAD_TARGET_DB) - (uneven ? UNEVEN_TIGHTER_DB : 0),
    shift,
    tolHigh,
    tolLow,
    weight,
    caps,
  }
}

/**
 * How far each band is outside its tolerance (0 inside), dB, from the deviations against the style target.
 * `margin` tightens the tolerances (the EQ solver aims a little inside them).
 */
export function toneExcess(tone: readonly number[], t: TuneTargets, margin = 0): number[] {
  return tone.map((d, i) => {
    if (!Number.isFinite(d)) return 0
    const s = d + t.shift[i]
    return Math.max(0, s - Math.max(0, t.tolHigh[i] - margin), -s - Math.max(0, t.tolLow[i] - margin))
  })
}
