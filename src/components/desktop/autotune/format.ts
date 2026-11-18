// On-screen values of the result step (numbers through src/i18n/format.ts).
import type { MetricRow } from '../../../desktop/autotune/results'
import type { TuneEffect } from '../../../desktop/tune'
import { BAND_KEYS } from '../../../desktop/tune/targets'
import { fmtDb, fmtDbfs, fmtNum } from '../../../i18n/format'

export const bandKey = (i: number): string => BAND_KEYS[i] ?? 'body'

/** A metric row's value: levels in dBFS, differences in dB, tone deviations signed. */
export const rowValue = (r: MetricRow, v: number): string => (r.unit === 'dbfs' ? fmtDbfs(v) : r.id === 'band' ? fmtDb(v) : fmtDb(v, 1, false))

/** A change's measured effect value in its metric's unit. */
export function effectValue(e: TuneEffect, v: number): string {
  switch (e.metric) {
    case 'speechDb':
    case 'peakDb':
      return fmtDbfs(v)
    case 'tone':
      return fmtDb(v)
    case 'deadSilence':
    case 'cutSpeech':
      return `${fmtNum(v * 100, 1)} %`
    default:
      return fmtDb(v, 1, false)
  }
}
