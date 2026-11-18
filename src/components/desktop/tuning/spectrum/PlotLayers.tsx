import { useTheme } from '@mui/material/styles'
import { useMemo } from 'react'
import { eqCurveDb, type EqPoint, type SpectrumTone } from '../../../../desktop/spectrum'
import { fmtHz } from '../../../../i18n/format'
import { curvePaths, xOfHz, type PlotBox } from './plotScale'

/** What the switched-on bands do together: a 2 px line in the info colour, a faint fill to the 0 dB line. */
export function EqCurve({ box, freqs, points }: { box: PlotBox; freqs: Float32Array; points: readonly EqPoint[] }) {
  const theme = useTheme()
  const info = theme.vars?.palette.info.main ?? theme.palette.info.main
  const { line, area } = useMemo(() => curvePaths(box, freqs, eqCurveDb(points, freqs)), [box, freqs, points])
  return (
    <g aria-hidden="true" data-testid="spectrum-eq-curve">
      <path d={area} fill={info} fillOpacity={0.12} stroke="none" />
      <path d={line} fill="none" stroke={info} strokeWidth={2} />
    </g>
  )
}

/** A dashed line in the warning colour at each steady tone, its frequency on top. */
export function ToneMarkers({ box, tones }: { box: PlotBox; tones: readonly SpectrumTone[] }) {
  const theme = useTheme()
  const warn = theme.vars?.palette.warning.main ?? theme.palette.warning.main
  const paper = theme.vars?.palette.background.paper ?? theme.palette.background.paper
  return (
    <g aria-hidden="true">
      {tones.map((t) => {
        const x = xOfHz(box, t.freqHz)
        return (
          <g key={t.freqHz} data-testid="spectrum-tone-marker">
            <line x1={x} x2={x} y1={box.top} y2={box.top + box.height} stroke={warn} strokeWidth={1.5} strokeDasharray="4 3" />
            <text x={x} y={box.top - 5} textAnchor="middle" fontSize={10} fill={warn} stroke={paper} strokeWidth={3} paintOrder="stroke">
              {fmtHz(t.freqHz)}
            </text>
          </g>
        )
      })}
    </g>
  )
}
