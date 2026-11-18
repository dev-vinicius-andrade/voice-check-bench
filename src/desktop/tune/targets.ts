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
/** "Too loud" picked: aim this much under the middle of the good range (still inside it), dB. */
export const TOO_LOUD_LESS_DB = 2
/** "Crackling" picked (the sound breaks up on loud moments): this much more room under the peak ceiling, dB. */
export const CRACKLE_HEADROOM_DB = 4

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
/**
 * "Flat, no dynamics" picked (the opposite of "uneven volume"; both picked cancel): the spread may be this much wider,
 * and under the use's own target minus this much it is too flat (the compressor lets go: ratio down, threshold up), dB.
 */
export const FLAT_LOOSER_DB = 2
/**
 * "Words cut off" picked: cut speech counts this many times in the damage, and the gate sits this share of the way up
 * from the pauses to the quiet syllables (instead of ./stages.ts GATE_GAP_SHARE) with this release, ms.
 */
export const WORDS_CUT_WEIGHT = 2
export const WORDS_CUT_GAP_SHARE = 0.5
export const WORDS_CUT_RELEASE_MS = 600
/** "Noise comes and goes" picked: bursts in the pauses and a gate's pumping count this many times. */
export const NOISE_PUMPS_WEIGHT = 2
/**
 * "Metallic or robotic voice" picked (Noise Removal's artifacts; it wins over "high hiss" and over strong "room
 * noise"): Noise Removal's step and cap are this share of the amount's, and one already stronger comes down to the cap.
 */
export const METALLIC_NR_SHARE = 0.5
/** "High hiss" picked: Noise Removal may go this much further than the amount allows, and the voice over the room wanted is at least this, dB. */
export const HISS_NR_SHARE = 1.5
export const HISS_SNR_DB = 35

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
  /** Highest Noise Removal strength in absolute terms ("metallic": one that sits higher comes down to it), 0..100. */
  nrCeil: number
}

const CAPS: Readonly<Record<ProcessingAmount, TuneCaps>> = {
  light: { eqStepDb: AMOUNT_STEP_DB.light, eqTotalDb: 3 * AMOUNT_STEP_DB.light, nrStep: 10, nrMax: 20, gateDb: GATE_STEP_DB / 2, ratio: 2, nrCeil: 100 },
  medium: { eqStepDb: AMOUNT_STEP_DB.medium, eqTotalDb: 3 * AMOUNT_STEP_DB.medium, nrStep: 20, nrMax: 40, gateDb: GATE_STEP_DB, ratio: 3, nrCeil: 100 },
  strong: { eqStepDb: AMOUNT_STEP_DB.strong, eqTotalDb: 3 * AMOUNT_STEP_DB.strong, nrStep: 40, nrMax: 80, gateDb: GATE_STEP_DB * 2, ratio: 4, nrCeil: 100 },
}

/** The caps of an amount (medium for an unknown one), before any limit. */
export const capsOf = (amount: ProcessingAmount): TuneCaps => CAPS[amount] ?? CAPS.medium

/**
 * Strengths a Noise Removal that was off is tried at, lightest first: 0, 5, 10, one step and the amount's cap (counted
 * from 0), inside that cap. The tuner's switch candidate (switches.ts) and the live noise calibration (../calibrate)
 * walk the same ladder.
 */
export const nrLadder = (caps: Pick<TuneCaps, 'nrStep' | 'nrMax'>): number[] =>
  [...new Set([0, 5, 10, caps.nrStep, caps.nrMax])].filter((v) => v <= caps.nrMax).sort((a, b) => a - b)

export interface TuneTargets {
  style: VoiceStyle
  /** Speech level to reach, dBFS. */
  speechDb: number
  /** Peaks stay under this when the level is raised, dBFS. */
  peakCeilDb: number
  /** Wanted voice over pause noise, dB. */
  snrDb: number
  /**
   * The use's own voice-over-room target, dB (what `snrDb` is without "room noise" picked). The 45 dB of "room
   * noise" is a wish for the noise stage; a tone fix may cost voice over the room down to this (toneJudge).
   */
  snrFloorDb: number
  /** Pauses may drop to digital silence (the person asked for as much removal as possible). */
  allowDeadSilence: boolean
  /** Wanted level spread, dB (at most). */
  spreadDb: number
  /** Under this spread the voice is too flat ("flat, no dynamics" picked), dB; NaN: no lower bound. */
  spreadMinDb: number
  /** How many times cut speech, bursts in the pauses and a gate's pumping count ("words cut off", "noise comes and goes"). */
  cutWeight: number
  burstWeight: number
  pumpWeight: number
  /**
   * Bursts in the pauses cost noise points only when they come closer to the voice than this, dB (when it is under
   * `snrDb`). Unset: they are held to `snrDb`. Set by the compression stage for its own moves (stages.ts
   * COMP_BURST_OK_DB); the burst stage after it and the result still hold them to `snrDb`.
   */
  burstSnrDb?: number
  /** "Uneven volume" picked (without "noise comes and goes"): an even level comes before the last few dB of the bursts in the pauses. */
  evenFirst: boolean
  /** "Words cut off": the gentler gate (gateGapShare, a longer release) and a gate off when Noise Removal carries the pauses. */
  gentleGate: boolean
  gateGapShare: number
  /** "Metallic" picked: Noise Removal kept light, and the result says the room comes back. */
  metallic: boolean
  /** "Low hum or rumble": a narrow EQ cut on a mains hum the pauses show. "High hiss": less of the top when the room rules there. */
  humCut: boolean
  hissCut: boolean
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
  // clarity = consonant definition (1.25–2.5 k) over what masks it: the low-mids (160–640)
  lacksClarity: [[5, -1], [3, 1], [2, 1]],
  lacksPresence: [[6, -1]],
  // body = the chest of the voice (160–320) and its core (640–1.25 k); "thin" is the lows below that
  lacksBody: [[2, -1], [4, -1]],
  // nasal honk sits in 640–1.25 k; boxy (small-room, cardboard) in 320–640
  nasal: [[4, 1]],
  boxy: [[3, 1]],
  // popping P and B, a low hum or rumble: the lows under the voice down (rumble counts while one of these is picked)
  plosives: [[0, 1], [1, 1]],
  hum: [[0, 1], [1, 1]],
}

const SNR_BY_USE: Readonly<Record<TuneUse, number>> = { streaming: SNR_TARGET_DB, calls: SNR_TARGET_CALLS_DB, recording: SNR_TARGET_DB }
const SPREAD_BY_USE: Readonly<Record<TuneUse, number>> = { streaming: SPREAD_TARGET_DB, calls: SPREAD_TARGET_LOOSE_DB, recording: SPREAD_TARGET_LOOSE_DB }

/** The style's offsets per band (natural for an unknown style). */
export const styleOffsets = (style: VoiceStyle): readonly number[] => (Object.hasOwn(STYLE_OFFSETS, style) ? STYLE_OFFSETS[style] : STYLE_OFFSETS.natural)

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1)

/** The share of the pause-to-syllable gap a gate sits at by default (./stages.ts GATE_GAP_SHARE). */
export const GATE_GAP_SHARE_BASE = 0.7

/**
 * Targets and caps of a run.
 * - use: streaming → SNR 30 dB, spread 8 dB (the audience hears exactly this) · calls → SNR 25 dB, spread 10 dB (the
 *   call app removes noise and levels the voice again) · recording → SNR 30 dB, spread 10 dB, and pauses never drop
 *   to digital silence (it cannot be edited back).
 * - style: the tone target (reference curve + the style's offsets).
 * - bothers: roomNoise → SNR target SNR_CAP (45 dB, where more stops counting); with amount strong (never for
 *   recording) pauses may go dead silent · tooQuiet → speech target +2 dB · tooLoud → speech target −2 dB (both picked cancel) · crackling → peaks kept 4 dB lower · unevenVolume → spread target −2 dB and one
 *   more ratio step · boomy / thin / muffled / harsh / sharpS / dull / lacksClarity / lacksPresence / lacksBody / nasal / boxy → their bands (BOTHER_BANDS) are aimed BY_EAR_DB
 *   past the style target against the complaint, must come within 1 dB on that side (every other band: 3 dB) and
 *   count double in the tone score.
 *   Opposite complaints on one band cancel the shift and keep the tight tolerance on both sides.
 *   plosives / hum → rumble and boom heard as too much (rumble, otherwise not judged, counts while picked); hum also
 *   cuts a mains hum the pauses show (humCut, ./botherStages.ts).
 * - wordsCut → cut speech counts WORDS_CUT_WEIGHT times, the gate sits WORDS_CUT_GAP_SHARE of the way up with a
 *   WORDS_CUT_RELEASE_MS release, and a gate goes off when Noise Removal carries the pauses (gentleGate).
 * - noisePumps → bursts in the pauses and a gate's pumping count NOISE_PUMPS_WEIGHT times.
 * - flat → spread target FLAT_LOOSER_DB looser and, under the use's own target − FLAT_LOOSER_DB, too flat; one ratio
 *   step less. Picked with unevenVolume, both cancel (as tooQuiet / tooLoud).
 * - metallic → Noise Removal's step and cap × METALLIC_NR_SHARE, and its strength never over that cap (nrCeil); it wins
 *   over hiss (no stronger removal for it) and over strong roomNoise (no dead-silent pauses allowed for it).
 * - hiss → Noise Removal's cap × HISS_NR_SHARE, the voice over the room wanted at least HISS_SNR_DB, and less of the
 *   top when the room rules there (hissCut).
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
      // a band not judged otherwise (rumble) counts while a complaint points at it
      weight[band] = (TONE_WEIGHTS[band] || 1) * BOTHER_WEIGHT
      shift[band] += side * BY_EAR_DB
      if (side > 0) tolHigh[band] = TONE_BOTHER_TOL_DB
      else tolLow[band] = TONE_BOTHER_TOL_DB
    }
  }
  const base = capsOf(goals.amount)
  // opposites cancel: uneven volume and flat; metallic wins over hiss
  const uneven = has('unevenVolume') && !has('flat')
  const flat = has('flat') && !has('unevenVolume')
  const metallic = has('metallic')
  const hiss = has('hiss') && !metallic
  const nrShare = metallic ? METALLIC_NR_SHARE : hiss ? HISS_NR_SHARE : 1
  const caps: TuneCaps = {
    eqStepDb: base.eqStepDb * k,
    eqTotalDb: base.eqTotalDb * k,
    nrStep: Math.round(base.nrStep * k * (metallic ? METALLIC_NR_SHARE : 1)),
    nrMax: Math.round(base.nrMax * k * nrShare),
    gateDb: base.gateDb * k,
    ratio: Math.max(1, 1 + (base.ratio + (uneven ? 1 : 0) - (flat ? 1 : 0) - 1) * k),
    nrCeil: metallic ? Math.round(base.nrMax * k * METALLIC_NR_SHARE) : 100,
  }
  const spread = SPREAD_BY_USE[goals.use] ?? SPREAD_TARGET_DB
  const useSnr = SNR_BY_USE[goals.use] ?? SNR_TARGET_DB
  return {
    style: goals.style,
    speechDb: TARGET_SPEECH_DB + (has('tooQuiet') ? TOO_QUIET_EXTRA_DB : 0) - (has('tooLoud') ? TOO_LOUD_LESS_DB : 0),
    peakCeilDb: PEAK_WARN_DB - PEAK_MARGIN_DB - (has('crackling') ? CRACKLE_HEADROOM_DB : 0),
    snrDb: has('roomNoise') ? SNR_CAP : hiss ? Math.max(useSnr, HISS_SNR_DB) : useSnr,
    snrFloorDb: useSnr,
    allowDeadSilence: has('roomNoise') && goals.amount === 'strong' && goals.use !== 'recording' && !metallic,
    spreadDb: spread - (uneven ? UNEVEN_TIGHTER_DB : 0) + (flat ? FLAT_LOOSER_DB : 0),
    spreadMinDb: flat ? spread - FLAT_LOOSER_DB : NaN,
    cutWeight: has('wordsCut') ? WORDS_CUT_WEIGHT : 1,
    burstWeight: has('noisePumps') ? NOISE_PUMPS_WEIGHT : 1,
    pumpWeight: has('noisePumps') ? NOISE_PUMPS_WEIGHT : 1,
    evenFirst: uneven && !has('noisePumps'),
    gentleGate: has('wordsCut'),
    gateGapShare: has('wordsCut') ? WORDS_CUT_GAP_SHARE : GATE_GAP_SHARE_BASE,
    metallic,
    humCut: has('hum'),
    hissCut: hiss,
    shift,
    tolHigh,
    tolLow,
    weight,
    caps,
  }
}

/**
 * The targets the tone stage is judged against (its plans, and the branch without ReaFIR): the same, with the voice
 * over the room wanted only up to the use's own target. With "room noise" picked, every dB under 45 dB cost the tone
 * stage 1.5 points, so no cut of the loudest part of a voice was ever kept (it lowers the whole voice against the
 * room) and the person in the noisy room kept the muddy voice. The noise stage still aims at `snrDb`, and the result
 * still says when the wish was not reached.
 */
export const toneJudge = (t: TuneTargets): TuneTargets => (t.snrDb > t.snrFloorDb ? { ...t, snrDb: t.snrFloorDb } : t)

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
