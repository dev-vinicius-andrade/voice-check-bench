import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { TARGET_SPEECH_DB } from '../../../audio/diagnose'
import { fmtNum } from '../../../i18n/format'
import { HISTORY_MS, type HistoryPoint, type LiveHistory } from '../../../live/history'
import { useMsg } from '../../common/MsgText'

const C = {
  fx: 'var(--mui-palette-primary-main)',
  raw: 'var(--mui-palette-text-secondary)',
  target: 'var(--mui-palette-success-main)',
  marker: 'var(--mui-palette-text-secondary)',
  line: 'var(--mui-palette-divider)',
  muted: 'var(--mui-palette-text-secondary)',
  paper: 'var(--mui-palette-background-paper)',
}
const W = 880, H = 220, L = 40, R = 10, T = 22, B = 22, LO = -60, HI = 0
const GRID = [-60, -45, -30, -15, 0]
const y = (db: number): number => T + ((HI - Math.max(LO, Math.min(HI, db))) / (HI - LO)) * (H - T - B)

/** Polyline paths of the finite values, broken where a value is missing. */
function paths(points: readonly HistoryPoint[], x: (t: number) => number, v: (p: HistoryPoint) => number): string[] {
  const out: string[] = []
  let cur = ''
  for (const p of points) {
    const d = v(p)
    if (!Number.isFinite(d)) {
      if (cur) out.push(cur)
      cur = ''
      continue
    }
    cur += `${cur ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(d).toFixed(1)}`
  }
  if (cur) out.push(cur)
  return out
}

function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="flex flex-wrap gap-4">
      {items.map((it) => (
        <Typography key={it.label} variant="caption" color="text.secondary" className="flex items-center gap-1.5">
          <Box component="span" sx={{ width: 16, borderTop: 2, borderColor: it.color, borderTopStyle: it.dashed ? 'dashed' : 'solid' }} />
          {it.label}
        </Typography>
      ))}
    </div>
  )
}

/** "Last 60 seconds": speech level with effects and of the mic alone, the −21 dBFS target, a marker at each change. */
export function HistoryChart({ history }: { history: LiveHistory }) {
  const { t } = useTranslation()
  const tm = useMsg()
  const end = history.points.at(-1)?.t ?? 0
  const x = (tt: number): number => L + ((tt - (end - HISTORY_MS)) / HISTORY_MS) * (W - L - R)
  const target = t('desktop.tune.chart.target', { db: fmtNum(TARGET_SPEECH_DB, 0) })
  return (
    <Paper component="section" className="grid gap-2 p-4" aria-labelledby="tune-chart-title" data-testid="tune-chart">
      <Typography id="tune-chart-title" variant="h6" component="h2">{t('desktop.tune.chart.title')}</Typography>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('desktop.tune.chart.aria')} style={{ width: '100%', minWidth: 560, display: 'block', fontFamily: 'inherit' }}>
          {GRID.map((v) => (
            <g key={v}>
              <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={C.line} />
              <text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill={C.muted}>{fmtNum(v, 0)}</text>
            </g>
          ))}
          <line x1={L} x2={W - R} y1={y(TARGET_SPEECH_DB)} y2={y(TARGET_SPEECH_DB)} stroke={C.target} strokeWidth={2} strokeDasharray="6 4" />
          {paths(history.points, x, (p) => p.rawSpeechDb).map((d) => (
            <path key={`r${d}`} d={d} fill="none" stroke={C.raw} strokeWidth={1.5} />
          ))}
          {paths(history.points, x, (p) => p.fxSpeechDb).map((d) => (
            <path key={`f${d}`} d={d} fill="none" stroke={C.fx} strokeWidth={2.5} />
          ))}
          {history.markers.map((m) => (
            <g key={`${m.t}-${m.label.key}`} data-testid="tune-chart-marker">
              <line x1={x(m.t)} x2={x(m.t)} y1={T - 8} y2={H - B} stroke={C.marker} strokeDasharray="3 3" />
              <text x={x(m.t) + 3} y={T - 10} fontSize={10} fill={C.muted} stroke={C.paper} strokeWidth={3} paintOrder="stroke">{tm(m.label)}</text>
            </g>
          ))}
        </svg>
      </div>
      <Legend
        items={[
          { label: t('desktop.tune.chart.processed'), color: C.fx },
          { label: t('desktop.tune.chart.raw'), color: C.raw },
          { label: target, color: C.target, dashed: true },
        ]}
      />
    </Paper>
  )
}
