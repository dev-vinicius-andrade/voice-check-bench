import { useTheme } from '@mui/material/styles'
import { fmtNum, fmtSigned } from '../../../../i18n/format'
import { GAIN_RANGE, GRID_HZ, hzTick, SPEC_GRID_DB, xOfHz, yOfDbfs, yOfGain, type PlotBox } from './plotScale'

const GAIN_TICKS = [-GAIN_RANGE, -GAIN_RANGE / 2, 0, GAIN_RANGE / 2, GAIN_RANGE]

/** Axis labels: dBFS on the left, Hz below, the EQ's dB on the right (when a ReaEQ curve is shown) with its 0 dB line. */
export function PlotAxes({ box, eq }: { box: PlotBox; eq: boolean }) {
  const theme = useTheme()
  const muted = theme.vars?.palette.text.secondary ?? theme.palette.text.secondary
  const info = theme.vars?.palette.info.main ?? theme.palette.info.main
  const right = box.left + box.width
  const bottom = box.top + box.height
  return (
    <g fontSize={10} fill={muted} aria-hidden="true" style={{ fontVariantNumeric: 'tabular-nums' }}>
      {SPEC_GRID_DB.map((db) => (
        <text key={`l${db}`} x={box.left - 4} y={yOfDbfs(box, db) + 3} textAnchor="end">{fmtNum(db, 0)}</text>
      ))}
      {GRID_HZ.map((hz) => (
        <text key={`f${hz}`} x={xOfHz(box, hz)} y={bottom + 13} textAnchor="middle">{hzTick(hz, (v) => fmtNum(v, 0))}</text>
      ))}
      <text x={box.left - 4} y={bottom + 13} textAnchor="end">Hz</text>
      {eq && (
        <>
          <line x1={box.left} x2={right} y1={yOfGain(box, 0)} y2={yOfGain(box, 0)} stroke={info} strokeOpacity={0.35} />
          {GAIN_TICKS.map((db) => (
            <text key={`r${db}`} x={right + 4} y={yOfGain(box, db) + 3} fill={info}>{fmtSigned(db, 0)}</text>
          ))}
          <text x={right + 4} y={bottom + 13} fill={info}>dB</text>
        </>
      )}
      <text x={box.left - 4} y={box.top - 6} textAnchor="end">dBFS</text>
    </g>
  )
}
