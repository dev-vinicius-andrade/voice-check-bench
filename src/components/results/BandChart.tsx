import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { BANDS, deviations } from '../../audio/reference'
import type { Analysis, ChartView } from '../../types'

const C = {
  zone: 'var(--mui-palette-success-main)',
  a: 'var(--mui-palette-primary-main)',
  b: 'var(--mui-palette-info-main)',
  line: 'var(--mui-palette-divider)',
  ink: 'var(--mui-palette-text-primary)',
  muted: 'var(--mui-palette-text-secondary)',
}
const ZONE_ALPHA = 0.16
const W = 880, H = 290, L = 46, R = 10, T = 14, BM = 46, LO = -15, HI = 15
const CW = (W - L - R) / BANDS.length
const y = (v: number): number => T + ((HI - Math.max(LO, Math.min(HI, v))) / (HI - LO)) * (H - T - BM)
const GRID = [-15, -10, -5, 0, 5, 10, 15]
const sign = (v: number): string => (v > 0 ? '+' : '')

function Bar({ v, x, color, width, diff }: { v: number; x: number; color: string; width: number; diff: boolean }) {
  const yy = y(v)
  const quiet = !diff && Math.abs(v) <= 3
  return (
    <>
      <line x1={x} x2={x} y1={y(0)} y2={yy} stroke={color} strokeWidth={width} opacity={0.85} />
      <text x={x} y={v >= 0 ? yy - 6 : yy + 14} textAnchor="middle" fontSize={11} fontWeight={600} fill={quiet ? C.muted : C.ink}>
        {sign(v) + v.toFixed(0)}
      </text>
    </>
  )
}

function Chart({ rA, rB, diff }: { rA: number[]; rB: number[] | null; diff: boolean }) {
  const label = `${diff ? 'Difference between takes' : 'Deviation from reference voice'} per octave`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} style={{ width: '100%', minWidth: 600, display: 'block', fontFamily: 'inherit' }}>
      {!diff && (
        <>
          <rect x={L} y={y(6)} width={W - L - R} height={y(-6) - y(6)} fill={C.zone} fillOpacity={ZONE_ALPHA * 0.45} />
          <rect x={L} y={y(3)} width={W - L - R} height={y(-3) - y(3)} fill={C.zone} fillOpacity={ZONE_ALPHA} />
        </>
      )}
      {GRID.map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={C.line} strokeWidth={v === 0 ? 2 : 1} />
          <text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill={C.muted}>{sign(v) + v}</text>
        </g>
      ))}
      {BANDS.map((b, i) => {
        const cx = L + i * CW + CW / 2
        return (
          <g key={b.name}>
            <Bar v={rA[i]} x={rB ? cx - CW * 0.14 : cx} color={C.a} width={rB ? 10 : 16} diff={diff} />
            {rB && <Bar v={rB[i]} x={cx + CW * 0.14} color={C.b} width={10} diff={diff} />}
            <text x={cx} y={H - 26} textAnchor="middle" fontSize={11} fontWeight={600} fill={C.ink}>{b.label}</text>
            <text x={cx} y={H - 11} textAnchor="middle" fontSize={10} fill={C.muted}>{b.name}</text>
          </g>
        )
      })}
    </svg>
  )
}

function Legend({ items }: { items: { label: string; color: string; alpha?: number }[] }) {
  return (
    <div className="flex flex-wrap gap-4">
      {items.map((it) => (
        <Typography key={it.label} variant="caption" color="text.secondary" className="flex items-center gap-1.5">
          <Box component="span" sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: it.color, opacity: it.alpha ?? 1 }} />
          {it.label}
        </Typography>
      ))}
    </div>
  )
}

/** Per-octave deviation chart (prototype drawChart). 'diff' plots A − B without the reference zones. */
export function BandChart({ a, b, view }: { a: Analysis; b: Analysis | null; view: ChartView }) {
  const dA = deviations(a.rel)
  const dB = b ? deviations(b.rel) : null
  const diff = view === 'diff' && !!dB
  const title = diff ? 'Difference A − B per octave' : 'Tone balance vs reference voice'
  const note = diff
    ? 'Bars up: A has more of that band than B (after level-matching). With A = processed and B = a raw control, this is what your effects change.'
    : '0 = matches a clear spoken-voice curve. Up = too much of that band, down = too little. Inside ±3 dB is fine, ±6 dB is noticeable.'
  const legend = diff
    ? [{ label: 'A − B', color: C.a }]
    : [
        { label: '±3 dB / ±6 dB', color: C.zone, alpha: ZONE_ALPHA * 2 },
        { label: 'A', color: C.a },
        ...(view === 'ab' && dB ? [{ label: 'B', color: C.b }] : []),
      ]
  return (
    <div className="grid gap-2">
      <div>
        <Typography variant="h6" component="h2">{title}</Typography>
        <Typography variant="body2" color="text.secondary">{note}</Typography>
      </div>
      <div className="overflow-x-auto">
        <Chart rA={diff && dB ? dA.map((v, i) => v - dB[i]) : dA} rB={view === 'ab' ? dB : null} diff={diff} />
      </div>
      <Legend items={legend} />
    </div>
  )
}
