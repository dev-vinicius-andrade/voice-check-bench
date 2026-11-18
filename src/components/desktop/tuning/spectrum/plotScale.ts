// Live spectrum plot geometry (SPEC "Live spectrum"): log frequency on x, two vertical scales sharing the area (the
// spectrum in dBFS, the EQ curve in dB around a 0 dB centre line). Pure, no React.
import { EQ_LIMITS, SPECTRUM_MAX_HZ, SPECTRUM_MIN_HZ, SPECTRUM_POINTS } from '../../../../desktop/spectrum'

/** Room around the plot area, px: dBFS labels left, EQ dB labels right, tone labels on top, Hz labels below. */
export const PAD = { left: 40, right: 34, top: 18, bottom: 20 } as const
/** The spectrum's vertical range, dBFS (bottom, top). */
export const SPEC_DB = [-100, -20] as const
export const SPEC_GRID_DB = [-100, -80, -60, -40, -20] as const
/** Frequencies with a grid line and a label. */
export const GRID_HZ = [50, 100, 200, 500, 1000, 2000, 5000, 10000] as const
/** The EQ scale and a handle's drag range are ± this many dB: the plugin takes ±40, where the usual few dB would be flat (the fields take the full range). */
export const GAIN_RANGE = 24
/** Arrow keys move a band this many octaves. */
export const FREQ_STEP_OCT = 1 / 24
export const GAIN_STEP_DB = 0.5
/** `[` / `]` and one wheel notch make a band this much narrower or wider (a ratio, so the step suits any width). */
export const WIDTH_STEP = 2 ** (1 / 4)

/** The plot area inside the drawing, px. */
export interface PlotBox {
  left: number
  top: number
  width: number
  height: number
}

export const plotBox = (w: number, h: number): PlotBox => ({
  left: PAD.left,
  top: PAD.top,
  width: Math.max(1, w - PAD.left - PAD.right),
  height: Math.max(1, h - PAD.top - PAD.bottom),
})

export const clamp = (v: number, [lo, hi]: readonly [number, number]): number => Math.min(hi, Math.max(lo, v))

const LOG_SPAN = Math.log(SPECTRUM_MAX_HZ / SPECTRUM_MIN_HZ)

export const xOfHz = (b: PlotBox, hz: number): number => b.left + (Math.log(Math.max(1e-6, hz) / SPECTRUM_MIN_HZ) / LOG_SPAN) * b.width
export const hzOfX = (b: PlotBox, x: number): number => SPECTRUM_MIN_HZ * Math.exp(((x - b.left) / b.width) * LOG_SPAN)

const [DB_LO, DB_HI] = SPEC_DB
export const yOfDbfs = (b: PlotBox, db: number): number => b.top + ((DB_HI - clamp(db, SPEC_DB)) / (DB_HI - DB_LO)) * b.height
export const dbfsOfY = (b: PlotBox, y: number): number => DB_HI - ((y - b.top) / b.height) * (DB_HI - DB_LO)

/** EQ gain on the shared area: 0 dB on the horizontal centre line, ±GAIN_RANGE at the edges. */
export const yOfGain = (b: PlotBox, db: number): number => b.top + b.height / 2 - (clamp(db, [-GAIN_RANGE, GAIN_RANGE]) / GAIN_RANGE) * (b.height / 2)
export const gainOfY = (b: PlotBox, y: number): number => ((b.top + b.height / 2 - y) / (b.height / 2)) * GAIN_RANGE

export const snapGain = (db: number): number => clamp(Math.round(db / GAIN_STEP_DB) * GAIN_STEP_DB, EQ_LIMITS.gainDb) + 0
export const clampFreq = (hz: number): number => clamp(hz, EQ_LIMITS.freqHz)
export const stepFreq = (hz: number, dir: number): number => clampFreq(hz * 2 ** (dir * FREQ_STEP_OCT))
/** One width step: dir < 0 narrower, dir > 0 wider; rounded to 0.01 oct. */
export const stepWidth = (oct: number, dir: number): number => clamp(Math.round(oct * WIDTH_STEP ** Math.sign(dir) * 100) / 100, EQ_LIMITS.bwOct)

/** The plot's frequencies: SPECTRUM_POINTS log-spaced from SPECTRUM_MIN_HZ to SPECTRUM_MAX_HZ (as LiveSpectrum.freqsHz). */
export function plotFreqs(): Float32Array {
  const out = new Float32Array(SPECTRUM_POINTS)
  for (let i = 0; i < SPECTRUM_POINTS; i++) out[i] = SPECTRUM_MIN_HZ * Math.exp((i / (SPECTRUM_POINTS - 1)) * LOG_SPAN)
  return out
}

/** Index of the plot point nearest to `hz` (log distance). */
export function nearestIndex(freqs: ArrayLike<number>, hz: number): number {
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < freqs.length; i++) {
    const d = Math.abs(Math.log(freqs[i] / hz))
    if (d < bestD) {
      best = i
      bestD = d
    }
  }
  return best
}

/** SVG paths of the EQ curve: the line, and the area between it and the 0 dB line. */
export function curvePaths(b: PlotBox, freqs: ArrayLike<number>, curveDb: ArrayLike<number>): { line: string; area: string } {
  const n = Math.min(freqs.length, curveDb.length)
  if (n === 0) return { line: '', area: '' }
  const pts: string[] = []
  for (let i = 0; i < n; i++) pts.push(`${xOfHz(b, freqs[i]).toFixed(1)},${yOfGain(b, curveDb[i]).toFixed(1)}`)
  const zero = yOfGain(b, 0).toFixed(1)
  const line = `M${pts.join('L')}`
  const area = `M${xOfHz(b, freqs[0]).toFixed(1)},${zero}L${pts.join('L')}L${xOfHz(b, freqs[n - 1]).toFixed(1)},${zero}Z`
  return { line, area }
}

/** Axis label of a grid frequency: 50, 100, 1k, 10k. */
export const hzTick = (hz: number, num: (v: number) => string): string => (hz >= 1000 ? `${num(hz / 1000)}k` : num(hz))
