import { useTheme } from '@mui/material/styles'
import { useTranslation } from 'react-i18next'
import { EQ_LIMITS, type EqPoint } from '../../../../desktop/spectrum'
import { fmtDb, fmtHz, fmtNum } from '../../../../i18n/format'
import { xOfHz, yOfGain, type PlotBox } from './plotScale'
import type { EqDrag } from './useEqDrag'

interface BandHandlesProps {
  box: PlotBox
  bands: readonly EqPoint[]
  selected: number | null
  drag: EqDrag
}

/**
 * One circle per ReaEQ band at (frequency, gain) with its number: radius 8, the selected one 10 with a ring; a
 * switched-off band hollow; an "Other" type shown but not draggable. Each is a focusable slider for the keyboard.
 */
export function BandHandles({ box, bands, selected, drag }: BandHandlesProps) {
  const { t } = useTranslation()
  const theme = useTheme()
  const info = theme.vars?.palette.info.main ?? theme.palette.info.main
  const ink = theme.vars?.palette.info.contrastText ?? theme.palette.info.contrastText
  const paper = theme.vars?.palette.background.paper ?? theme.palette.background.paper
  return (
    <g>
      {bands.map((p) => {
        const sel = p.n === selected
        const r = sel ? 10 : 8
        const fixed = p.type === 'Other'
        const hz = fmtHz(p.freqHz)
        const db = fmtDb(p.gainDb, 1)
        return (
          <g
            key={p.n}
            role="slider"
            tabIndex={0}
            data-band={p.n}
            data-testid={`spectrum-band-${p.n}`}
            aria-label={t('desktop.tune.spectrum.handle', { n: p.n, hz, db })}
            aria-valuetext={t('desktop.tune.spectrum.handleText', { hz, db, oct: fmtNum(p.bwOct, 2) })}
            aria-valuenow={p.gainDb}
            aria-valuemin={EQ_LIMITS.gainDb[0]}
            aria-valuemax={EQ_LIMITS.gainDb[1]}
            aria-disabled={fixed || undefined}
            transform={`translate(${xOfHz(box, p.freqHz)},${yOfGain(box, p.gainDb)})`}
            style={{ cursor: fixed ? 'default' : 'grab', touchAction: 'none', outlineOffset: 2 }}
            {...drag.bind(p)}
          >
            {sel && <circle r={r + 4} fill="none" stroke={info} strokeWidth={1.5} strokeOpacity={0.6} />}
            <circle r={r} fill={p.on ? info : paper} stroke={info} strokeWidth={2} />
            <text y={3.5} textAnchor="middle" fontSize={10} fontWeight={700} fill={p.on ? ink : info} pointerEvents="none">
              {p.n}
            </text>
          </g>
        )
      })}
    </g>
  )
}
