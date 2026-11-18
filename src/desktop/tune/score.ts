// The explicit score every tuner decision is judged against. Pure. Penalty points: 0 = nothing left to fix.
import { OVER_SWITCH_WARN, OVER_ZERO_WARN, PEAK_WARN_DB } from '../../audio/diagnose'
import { OVER_MAX, OVER_SWITCH_FULL, OVER_ZERO_FULL, SNR_CAP } from '../../plain/score'
import { bandsOfCells, robustTone, type Measured } from './measure'
import { N_BANDS, toneExcess, type TuneTargets } from './targets'
import type { TakeSummary, TuneScore } from './types'

/** The level is on target within this much, dB. */
export const LEVEL_TOL_DB = 1
/** Points per dB the peak sits above PEAK_WARN_DB, and for any clipped sample (the clarity score's clip penalty). */
export const PEAK_POINTS = 3
export const CLIP_POINTS = 15
/**
 * Points per dB of SNR missing (the clarity score's noise slope). The SNR counts from 0 to SNR_CAP, with no other
 * cap: a cap on the points (the clarity score stops at 45) would make every dB lost free once a noisy take is 30 dB
 * under a 45 dB "room noise" target — exactly when the person asked for less noise (a compressor lifting the room
 * 2.5 dB then cost nothing on the real chain).
 */
export const NOISE_POINTS = 1.5
/** Points per dB a band sits outside its tolerance (the clarity score's tone slope). */
export const TONE_POINTS = 1.2
/** Points per dB of level spread above the target (the clarity score's consistency slope). */
export const SPREAD_POINTS = 1.5
/** wordLossDb above this means quiet syllables are being cut off, dB; points per dB beyond it. */
export const CHOP_OK_DB = 2
export const CHOP_POINTS = 3
/**
 * Speech cut by a gate (measure.ts cutOf), when measured: up to this share of the voice frames is not heard as
 * chopping, percent; points per percent beyond it. Steep on purpose: it is damage, and no voice over the room is
 * worth words that start or end cut.
 */
export const CUT_OK_PCT = 1
export const CUT_POINTS = 8
/** Cut events (word starts or ends cut) per 10 s that pass, and points per event beyond them. */
export const CUT_OK_EVENTS = 1
export const CUT_EVENT_POINTS = 3
/** Whether a render's gates cut speech audibly (false while not measured). */
export const cutsSpeech = (m: Pick<Measured, 'cutShare' | 'cutEvents'>): boolean => 100 * m.cutShare > CUT_OK_PCT || m.cutEvents > CUT_OK_EVENTS

/** A change is kept only when the judged total drops by at least this many points… */
export const MIN_GAIN = 0.5
/**
 * …and no other part of the score gets worse by more than this many points, plus REGRESS_SHARE of what the change
 * wins on the part it is for (a compressor that wins 14 points of consistency may cost 5 of level). Damage never
 * gets that extra: no gain elsewhere pays for cut words or dead silence.
 */
export const REGRESS_TOL = 1.5
export const REGRESS_SHARE = 0.25
/**
 * The level stages' share: a trim's gain may cost the other parts (damage never) as much as it wins. A plugin after
 * the gain stage that reacts to level moves them on its own: on the real chain Elgato Noise Removal after ReaComp
 * read 4 tone points differently for 3 dB more Wet, and the speech stayed 2.8 dB under the target.
 */
export const LEVEL_REGRESS_SHARE = 1

/** How far the last gain stage (ReaComp Wet) can still move: dB down (≤ 0) and up (≥ 0) from where it is. */
export interface TrimRange {
  down: number
  up: number
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** Deviation of each band from the goal style's target for a render (robust level-match); NaN when the voice is gone. */
export const toneOf = (m: Measured, t: TuneTargets): number[] => (m.silent ? new Array<number>(N_BANDS).fill(NaN) : robustTone(bandsOfCells(m.cells), t.style))

/**
 * Gain the final trim would add to a render, dB: toward the speech target, never lifting the peak over the ceiling
 * (a peak already over it comes down), inside what the last gain stage can still do. 0 without a gain stage.
 */
export function trimGain(m: Measured, t: TuneTargets, trim: TrimRange | null): number {
  if (!trim || !Number.isFinite(m.speechDb)) return 0
  const want = Math.min(t.speechDb - m.speechDb, t.peakCeilDb - m.peakDb)
  return clamp(want, trim.down, trim.up)
}

/**
 * Level points with `gain` dB of trim still to come (0 = as rendered): 1 per dB the speech stays off the target
 * beyond LEVEL_TOL_DB, 3 per dB the peak ends above PEAK_WARN_DB, 15 when samples clipped.
 */
export function levelPoints(m: Measured, t: TuneTargets, gain = 0): number {
  if (!Number.isFinite(m.speechDb)) return 0
  const off = Math.max(0, Math.abs(t.speechDb - (m.speechDb + gain)) - LEVEL_TOL_DB)
  const peak = PEAK_POINTS * Math.max(0, m.peakDb + gain - PEAK_WARN_DB)
  return off + peak + (m.clipped > 0 ? CLIP_POINTS : 0)
}

/**
 * The score of a render.
 * - level: levelPoints. Between stages (`trim` given) only what the final trim could not repair counts, so a
 *   compressor or an EQ cut is not rejected for the level it costs and the trim gives back.
 * - noise: 1.5 per dB the voice-over-pause SNR (counted from 0 to SNR_CAP) is under the target.
 * - tone: 1.2 per dB a band is outside its tolerance, weighted (rumble 0, air 0.5).
 * - consistency: 1.5 per dB of level spread above the target.
 * - damage: up to 35 for digital silence (0 at 5 % zero samples or 6 cut-outs per 10 s, full at 30 % or 18; nothing
 *   when the goals allow dead-silent pauses) plus 3 per dB of word loss above 2 dB, plus, when the session measured
 *   what the gates cut against the ungated render, 8 per percent of cut speech beyond 1 % and 3 per cut event
 *   beyond 1 per 10 s.
 */
export function scoreOf(m: Measured, t: TuneTargets, trim: TrimRange | null = null): TuneScore {
  const level = levelPoints(m, t, trimGain(m, t, trim))
  const noise = Number.isFinite(m.snrDb) ? NOISE_POINTS * Math.max(0, t.snrDb - clamp(m.snrDb, 0, SNR_CAP)) : 0
  const excess = toneExcess(toneOf(m, t), t)
  const tone = TONE_POINTS * excess.reduce((s, e, i) => s + e * t.weight[i], 0)
  const consistency = SPREAD_POINTS * Math.max(0, m.spreadDb - t.spreadDb)
  const dead = t.allowDeadSilence
    ? 0
    : OVER_MAX *
      Math.max(
        clamp((m.deadSilence - OVER_ZERO_WARN) / (OVER_ZERO_FULL - OVER_ZERO_WARN), 0, 1),
        clamp((m.gateSwitches - OVER_SWITCH_WARN) / (OVER_SWITCH_FULL - OVER_SWITCH_WARN), 0, 1),
      )
  const cut = Number.isFinite(m.cutShare) ? CUT_POINTS * Math.max(0, 100 * m.cutShare - CUT_OK_PCT) + CUT_EVENT_POINTS * Math.max(0, m.cutEvents - CUT_OK_EVENTS) : 0
  const damage = dead + CHOP_POINTS * Math.max(0, m.wordLossDb - CHOP_OK_DB) + cut
  return { level, noise, tone, consistency, damage, total: level + noise + tone + consistency + damage }
}

export type ScorePart = Exclude<keyof TuneScore, 'total'>
export const SCORE_PARTS: readonly ScorePart[] = ['level', 'noise', 'tone', 'consistency', 'damage']

/**
 * Whether a render beats the one before it: the total drops by MIN_GAIN or more and no part other than the one the
 * change is for gets worse by more than REGRESS_TOL (+ `share`, REGRESS_SHARE by default, of the gain on that part,
 * except for damage).
 * `totalOnly`: the render before had lost the voice, so its parts mean nothing and only the total is compared.
 * Returns the reason it fails, or null when it is better.
 */
export function worseBecause(before: TuneScore, after: TuneScore, part: ScorePart, totalOnly = false, share = REGRESS_SHARE): string | null {
  const extra = share * Math.max(0, before[part] - after[part])
  for (const p of totalOnly ? [] : SCORE_PARTS) {
    const tol = REGRESS_TOL + (p === 'damage' ? 0 : extra)
    if (p !== part && after[p] > before[p] + tol) return `${p} got worse (${before[p].toFixed(1)} → ${after[p].toFixed(1)})`
  }
  if (!(after.total <= before.total - MIN_GAIN)) return `score ${before.total.toFixed(1)} → ${after.total.toFixed(1)}: no gain`
  return null
}

/** The public summary of a render, scored as rendered (no trim assumed). */
export function summarize(m: Measured, t: TuneTargets): TakeSummary {
  return {
    speechDb: m.speechDb,
    peakDb: m.peakDb,
    clipped: m.clipped,
    pauseDb: m.pauseDb,
    snrDb: m.snrDb,
    tone: toneOf(m, t),
    spreadDb: m.spreadDb,
    deadSilence: m.deadSilence,
    gateSwitches: m.gateSwitches,
    wordLossDb: m.wordLossDb,
    cutSpeech: m.cutShare,
    cutEvents: m.cutEvents,
    score: scoreOf(m, t),
  }
}
