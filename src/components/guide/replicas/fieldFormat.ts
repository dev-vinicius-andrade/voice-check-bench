// Value-field text for the replicas: the exact number to type into the plugin (always "." decimals, see fmtInput).
import { fmtInput } from '../../../i18n/format'

/** Fewest decimals between min and max that show v exactly (as rounded to max). */
export function fmtExact(v: number, min = 0, max = 2): string {
  if (!Number.isFinite(v)) return fmtInput(v)
  let d = min
  while (d < max && Math.abs(Math.round(v * 10 ** d) - v * 10 ** d) > 1e-6) d++
  return fmtInput(v, d)
}

/** Whole hertz, digits only: no thousands separator, people type it into the plugin. */
export const fmtHzField = (hz: number): string => (Number.isFinite(hz) ? String(Math.round(hz)) : '—')

/** dB field ("-6.0", "-7.5"). */
export const fmtDbField = (v: number): string => fmtExact(v, 1, 2)

/** Milliseconds field ("5", "100", "2.5"). */
export const fmtMsField = (v: number): string => fmtExact(v, 0, 1)

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** Nearest note name, like ReaEQ shows next to the frequency (A4 = 440 Hz): 150 → "D3". */
export function noteName(hz: number): string {
  if (!(hz > 0)) return ''
  const midi = Math.round(69 + 12 * Math.log2(hz / 440))
  return `${NOTES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`
}

/** 0..1 position of v on a linear or log scale, clamped. */
export function scalePos(v: number, min: number, max: number, log = false): number {
  if (!Number.isFinite(v)) return 0
  const p = log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min)
  return Math.min(1, Math.max(0, p))
}
