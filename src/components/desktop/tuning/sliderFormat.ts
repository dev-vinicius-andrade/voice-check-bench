// Slider values on screen (locale numbers via src/i18n/format.ts).
import type { SliderSpec } from '../../../desktop/sliderSpecs'
import { fmtDb, fmtHz, fmtNum } from '../../../i18n/format'

export function fmtSlider(s: SliderSpec, v: number): string {
  switch (s.unit) {
    case 'dB':
      return fmtDb(v, 1, false)
    case 'ms':
      return `${fmtNum(v, v < 10 ? 1 : 0)} ms`
    case 'ratio':
      return `${fmtNum(v, 1)}:1`
    case 'Hz':
      return fmtHz(v)
    default:
      return fmtNum(v, 0)
  }
}
