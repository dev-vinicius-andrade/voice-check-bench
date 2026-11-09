import type { Band } from '../types'

// Reference voice: octave sums of the long-term average speech spectrum,
// nudged toward a "clear broadcast voice" (a bit less low-mid, a bit more presence/air).
// Values are dB relative to 640–1250 Hz. The take is level-matched to this curve
// (mean offset over 80 Hz–10 kHz) and each band is judged by its deviation.
export const BANDS: Band[] = [
  { lo: 40, hi: 80, name: '40–80', label: 'Rumble', ref: -18 },
  { lo: 80, hi: 160, name: '80–160', label: 'Boom', ref: -4 },
  { lo: 160, hi: 320, name: '160–320', label: 'Warmth', ref: -1 },
  { lo: 320, hi: 640, name: '320–640', label: 'Mud / box', ref: 2 },
  { lo: 640, hi: 1250, name: '640–1.25k', label: 'Body', ref: 0 },
  { lo: 1250, hi: 2500, name: '1.25–2.5k', label: 'Definition', ref: -6 },
  { lo: 2500, hi: 5000, name: '2.5–5k', label: 'Presence', ref: -7 },
  { lo: 5000, hi: 10000, name: '5–10k', label: 'Sibilance', ref: -11 },
  { lo: 10000, hi: 16000, name: '10–16k', label: 'Air', ref: -17 },
]

/** Per-band deviation from the reference after level-matching over bands 1..7 (80 Hz–10 kHz). */
export function deviations(rel: readonly number[]): number[] {
  let s = 0
  for (let i = 1; i <= 7; i++) s += rel[i] - BANDS[i].ref
  const off = s / 7
  return rel.map((v, i) => v - BANDS[i].ref - off)
}

/** Seconds of silence at the start of every take (room noise measurement). */
export const QUIET_SEC = 3
/** Recording auto-stops after this many seconds. */
export const MAX_SEC = 30
