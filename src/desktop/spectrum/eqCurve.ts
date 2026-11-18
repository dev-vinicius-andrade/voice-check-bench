// ReaEQ on the spectrum plot: the bands of a chain slot, their combined curve and the notch for a steady tone.
// The curve is the model the guide and the tuner already use (src/audio/eqCurve.ts: RBJ cookbook biquads, bandwidth in
// octaves, at 48 kHz). Framework-free.
import { EQ_SAMPLE_RATE, eqResponseDb, type EqCurveBand } from '../../audio/eqCurve'
import { eqBands } from '../advice/chain'
import { BAND_MATCH_OCT, TONE_EQ } from '../advice/tone'
import type { ChainSlot } from '../advice/types'
import type { EqPoint, NotchPlan, SpectrumTone } from './types'

/** The bands of a ReaEQ chain slot, in plugin order. */
export function eqPointsOf(slot: ChainSlot): EqPoint[] {
  return eqBands(slot).map((b) => ({ n: b.n, type: b.type, on: b.on, freqHz: b.freqHz, gainDb: b.gainDb, bwOct: b.bwOct }))
}

/** A band the model can draw: enabled, a shelf or a Band, with finite values (an "Other" type is left out of the curve). */
const drawable = (p: EqPoint): p is EqPoint & { type: EqCurveBand['type'] } =>
  p.on && p.type !== 'Other' && p.freqHz > 0 && Number.isFinite(p.gainDb) && p.bwOct > 0

/** What the enabled bands do together at each frequency, dB (the curve the plot draws). */
export function eqCurveDb(points: readonly EqPoint[], freqsHz: Float32Array): Float32Array {
  const bands = points.filter(drawable).map((p) => ({ type: p.type, freq: p.freqHz, gain: p.gainDb, bw: p.bwOct }))
  return Float32Array.from(eqResponseDb(bands, Array.from(freqsHz), EQ_SAMPLE_RATE))
}

/**
 * Limits of what a band can be set to, as the app maps ReaEQ (the Wave Link tool's validateSuggestion in
 * src/wavelink/plugins.ts and the gain / frequency sliders of src/desktop/sliderSpecs.ts): frequency 20..20000 Hz,
 * gain −40..+40 dB, bandwidth 0.05..8 octaves.
 */
export const EQ_LIMITS = { freqHz: [20, 20000], gainDb: [-40, 40], bwOct: [0.05, 8] } as const

/** A band counts as unused when it is off or its gain is within this of 0 dB. */
export const FREE_GAIN_DB = 0.25
/** Width of a tone cut, octaves (src/settings/suggest.ts isNotch: a Band under 0.3 oct is a notch). */
export const NOTCH_BW_OCT = 0.1
/** A tone cut takes the tone this far under its surroundings, dB (gain = −(overDb + NOTCH_MARGIN_DB)). */
export const NOTCH_MARGIN_DB = 3
/** Deepest tone cut, dB. */
export const NOTCH_MAX_CUT_DB = 24

const r05 = (v: number): number => Math.round(v * 2) / 2 || 0
const clamp = (v: number, [lo, hi]: readonly [number, number]): number => Math.min(hi, Math.max(lo, v))

/**
 * The narrow cut for a steady tone on a band nothing else uses (type Band, off or at 0 dB ± FREE_GAIN_DB): first one
 * the tone advice and the tuner do not work with (not a guide band: GUIDE_BAND_HZ), then the one nearest the tone in
 * octaves (then the lower band number); null when none is free. A shelf or another type is never turned into a notch.
 */
/** The guide's own Band frequencies (warmth, mud, presence): a band near one is what the advice and the tuner move. */
export const GUIDE_BAND_HZ: readonly number[] = Object.values(TONE_EQ).filter((e) => e.type === 'Band').map((e) => e.freq)
const isGuide = (p: EqPoint): boolean => GUIDE_BAND_HZ.some((hz) => p.freqHz > 0 && Math.abs(Math.log2(p.freqHz / hz)) <= BAND_MATCH_OCT)

export function notchPlan(points: readonly EqPoint[], tone: SpectrumTone): NotchPlan | null {
  if (!(tone.freqHz > 0)) return null
  const dist = (p: EqPoint): number => (p.freqHz > 0 ? Math.abs(Math.log2(p.freqHz / tone.freqHz)) : Infinity)
  const free = points.filter((p) => p.type === 'Band' && (!p.on || Math.abs(p.gainDb) <= FREE_GAIN_DB)).sort((a, b) => Number(isGuide(a)) - Number(isGuide(b)) || dist(a) - dist(b) || a.n - b.n)
  const band = free[0]
  if (!band) return null
  const cut = Number.isFinite(tone.overDb) ? Math.max(0, tone.overDb) + NOTCH_MARGIN_DB : NOTCH_MAX_CUT_DB
  return {
    n: band.n,
    freqHz: clamp(Math.round(tone.freqHz * 10) / 10, EQ_LIMITS.freqHz),
    gainDb: clamp(r05(-cut), [Math.max(EQ_LIMITS.gainDb[0], -NOTCH_MAX_CUT_DB), 0]),
    bwOct: clamp(NOTCH_BW_OCT, EQ_LIMITS.bwOct),
    enable: !band.on,
  }
}
