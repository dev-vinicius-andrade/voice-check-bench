// OBS Studio filter values mapped from the suggestion (built-in filters only approximate the ReaPlugs chain). Pure.
import { isNotch } from '../../settings/suggest'
import type { Suggestion } from '../../types'

/** OBS 3-Band EQ crossovers (Hz): low below the first, high above the second. */
export const OBS_LOW_MID_HZ = 800
export const OBS_MID_HIGH_HZ = 5000
export const OBS_LIMITER_DB = -1
export const OBS_LIMITER_RELEASE_MS = 60
/** Expander ratio used for the soft gate of a noisy room. */
export const OBS_EXPANDER_RATIO = 2

export type ObsGate =
  | { kind: 'expander'; threshold: number; ratio: number; attack: number; release: number }
  | { kind: 'gate'; close: number; open: number; attack: number; hold: number; release: number }

export interface ObsValues {
  /** Noise Suppression (RNNoise) first: only in a noisy room. */
  noiseSuppression: boolean
  gate: ObsGate
  /** 3-Band EQ gains (dB), averaged from the suggested bands in each range; notches are left out. */
  eq3: { low: number; mid: number; high: number }
  /** The suggested EQ has fan/machine notches that 3-Band EQ cannot do (use the ReaEQ VST instead). */
  hasNotches: boolean
  comp: { ratio: number; threshold: number; attack: number; release: number; output: number }
  limiter: { threshold: number; release: number }
}

const r05 = (v: number): number => Math.round(v * 2) / 2
const avg = (xs: number[]): number => (xs.length ? r05(xs.reduce((a, b) => a + b, 0) / xs.length) : 0)

export function obsValues(s: Suggestion): ObsValues {
  const g = s.gate
  const bands = s.eq.filter((e) => !isNotch(e))
  const gainsIn = (lo: number, hi: number): number[] => bands.filter((e) => e.freq >= lo && e.freq < hi).map((e) => e.gain)
  return {
    noiseSuppression: s.noisyRoom,
    gate: s.noisyRoom
      ? { kind: 'expander', threshold: g.threshold, ratio: OBS_EXPANDER_RATIO, attack: g.attack, release: g.release }
      : { kind: 'gate', close: g.threshold + g.hysteresis, open: g.threshold, attack: g.attack, hold: g.hold, release: g.release },
    eq3: { low: avg(gainsIn(0, OBS_LOW_MID_HZ)), mid: avg(gainsIn(OBS_LOW_MID_HZ, OBS_MID_HIGH_HZ)), high: avg(gainsIn(OBS_MID_HIGH_HZ, Infinity)) },
    hasNotches: s.eq.some(isNotch),
    comp: { ratio: s.comp.ratio, threshold: s.comp.threshold, attack: s.comp.attack, release: s.comp.release, output: s.comp.wet },
    limiter: { threshold: OBS_LIMITER_DB, release: OBS_LIMITER_RELEASE_MS },
  }
}
