import { useTranslation } from 'react-i18next'
import { BANDS } from '../../audio/reference'
import { fmtNum } from '../../i18n/format'

const C = {
  bad: 'var(--mui-palette-error-main)',
  warn: 'var(--mui-palette-warning-main)',
  good: 'var(--mui-palette-success-main)',
  line: 'var(--mui-palette-divider)',
  ink: 'var(--mui-palette-text-primary)',
  muted: 'var(--mui-palette-text-secondary)',
}
const W = 880, H = 230, L = 46, R = 10, T = 18, BM = 46, MAX = 50
const CW = (W - L - R) / BANDS.length
const clamp = (v: number): number => Math.max(0, Math.min(MAX, v))
const y = (v: number): number => T + ((MAX - clamp(v)) / MAX) * (H - T - BM)
const GUIDES = [10, 20]
const colorOf = (v: number): string => (v < 10 ? C.bad : v < 20 ? C.warn : C.good)

/** Per-band voice-over-room SNR bars (0–50 dB) with 10 and 20 dB guides. */
export function BandSnrChart({ snr }: { snr: readonly number[] }) {
  const { t } = useTranslation()
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={t('results.room.chartAria')}
      style={{ width: '100%', minWidth: 600, display: 'block', fontFamily: 'inherit' }}
    >
      <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke={C.line} strokeWidth={2} />
      <text x={L - 6} y={y(0) + 4} textAnchor="end" fontSize={11} fill={C.muted}>0</text>
      <text x={L - 6} y={y(MAX) + 4} textAnchor="end" fontSize={11} fill={C.muted}>{MAX}</text>
      {GUIDES.map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={C.muted} strokeWidth={1} strokeDasharray="4 4" opacity={0.6} />
          <text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill={C.muted}>{v}</text>
        </g>
      ))}
      {BANDS.map((b, i) => {
        const cx = L + i * CW + CW / 2
        const v = snr[i]
        return (
          <g key={b.name}>
            <line x1={cx} x2={cx} y1={y(0)} y2={y(v)} stroke={colorOf(v)} strokeWidth={16} opacity={0.85} />
            <text x={cx} y={y(v) - 6} textAnchor="middle" fontSize={11} fontWeight={600} fill={C.ink}>
              {fmtNum(v, 0)}
            </text>
            <text x={cx} y={H - 26} textAnchor="middle" fontSize={11} fontWeight={600} fill={C.ink}>{t(`results.band.${i}`)}</text>
            <text x={cx} y={H - 11} textAnchor="middle" fontSize={10} fill={C.muted}>{b.name}</text>
          </g>
        )
      })}
    </svg>
  )
}
