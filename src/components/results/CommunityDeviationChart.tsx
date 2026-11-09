import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { BANDS } from '../../audio/reference'
import { fmtSigned } from '../../i18n/format'

// Same visual language as BandChart: theme CSS vars, A = primary, comparison = info, ±3 dB zone.
const C = {
  zone: 'var(--mui-palette-success-main)',
  you: 'var(--mui-palette-primary-main)',
  them: 'var(--mui-palette-info-main)',
  line: 'var(--mui-palette-divider)',
  ink: 'var(--mui-palette-text-primary)',
  muted: 'var(--mui-palette-text-secondary)',
}
const ZONE_ALPHA = 0.16
const W = 640, H = 200, L = 36, R = 8, T = 10, BM = 24, LO = -15, HI = 15
const CW = (W - L - R) / BANDS.length
const y = (v: number): number => T + ((HI - Math.max(LO, Math.min(HI, v))) / (HI - LO)) * (H - T - BM)
const GRID = [-10, 0, 10]

function Bar({ v, x, color, width }: { v: number; x: number; color: string; width: number }) {
  if (!Number.isFinite(v)) return null
  return <line x1={x} x2={x} y1={y(0)} y2={y(v)} stroke={color} strokeWidth={width} opacity={0.85} />
}

/** Paired per-octave deviation bars: your best raw control vs the community median for this mic. */
export function CommunityDeviationChart({ yours, community }: { yours: number[] | null; community: number[] }) {
  const { t } = useTranslation()
  const legend = [
    ...(yours ? [{ label: t('results.community.you'), color: C.you }] : []),
    { label: t('results.community.median'), color: C.them },
  ]
  return (
    <div className="grid gap-1">
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={t('results.community.chartAria')}
          style={{ width: '100%', minWidth: 480, display: 'block', fontFamily: 'inherit' }}
        >
          <rect x={L} y={y(3)} width={W - L - R} height={y(-3) - y(3)} fill={C.zone} fillOpacity={ZONE_ALPHA} />
          {GRID.map((v) => (
            <g key={v}>
              <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={C.line} strokeWidth={v === 0 ? 2 : 1} />
              <text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill={C.muted}>{fmtSigned(v, 0)}</text>
            </g>
          ))}
          {BANDS.map((b, i) => {
            const cx = L + i * CW + CW / 2
            return (
              <g key={b.name}>
                {yours && <Bar v={yours[i]} x={cx - CW * 0.14} color={C.you} width={9} />}
                <Bar v={community[i]} x={yours ? cx + CW * 0.14 : cx} color={C.them} width={9} />
                <text x={cx} y={H - 8} textAnchor="middle" fontSize={11} fontWeight={600} fill={C.ink}>{t(`results.band.${i}`)}</text>
              </g>
            )
          })}
        </svg>
      </div>
      <div className="flex flex-wrap gap-4">
        {legend.map((it) => (
          <Typography key={it.label} variant="caption" color="text.secondary" className="flex items-center gap-1.5">
            <Box component="span" sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: it.color }} />
            {it.label}
          </Typography>
        ))}
      </div>
    </div>
  )
}
