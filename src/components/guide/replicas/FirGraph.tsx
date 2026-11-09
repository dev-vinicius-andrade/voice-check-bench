import { useTranslation } from 'react-i18next'
import { fmtSigned } from '../../../i18n/format'
import { logFreqs } from '../../../audio/eqCurve'
import { RC } from './replicaStyle'
import type { ReaFirPanelProps } from './types'

const W = 600, H = 200, L = 34, R = 10, T = 10, B = 22, LO = 20, HI = 20000, TOP = 12, BOT = -96
const PW = W - L - R
/** How far the 'reduce' phase lowers the profile (the guide says 10–12 dB). */
const FIR_REDUCTION_DB = 11
const x = (f: number): number => L + (Math.log(f / LO) / Math.log(HI / LO)) * PW
const y = (db: number): number => T + ((TOP - Math.max(BOT, Math.min(TOP, db))) / (TOP - BOT)) * (H - T - B)
const r1 = (v: number): number => Math.round(v * 10) / 10
const FREQS = logFreqs(160, LO, HI)
const bump = (f: number, at: number, width: number, db: number): number => db * Math.exp(-((Math.log2(f / at) / width) ** 2))

/** Illustrative room-noise profile: falling broadband noise with a hum and a fan tone. Not measured data. */
const noiseProfileDb = (f: number): number => -48 - 4 * Math.log2(f / LO) + bump(f, 120, 0.08, 10) + bump(f, 780, 0.06, 8)

const pathOf = (dbAt: (f: number) => number): string => FREQS.map((f, i) => `${i ? 'L' : 'M'}${r1(x(f))},${r1(y(dbAt(f)))}`).join('')
const GRID_DB = [0, -24, -48, -72, -96]
const LABELS: [number, string][] = [[50, '50'], [100, '100'], [200, '200'], [500, '500'], [1000, '1k'], [2000, '2k'], [5000, '5k'], [10000, '10k'], [20000, '20k']]

/** ReaFIR response graph for each guide phase: flat (setup), profile being built, profile + lowered curve (reduce). */
export function FirGraph({ phase }: Pick<ReaFirPanelProps, 'phase'>) {
  const { t } = useTranslation()
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', fontFamily: 'inherit' }} data-testid="fir-graph" data-phase={phase}>
      <rect x={L} y={T} width={PW} height={H - T - B} fill={RC.surface} stroke={RC.line} />
      {GRID_DB.map((v) => (
        <g key={v}>
          <line x1={L} x2={L + PW} y1={y(v)} y2={y(v)} stroke={RC.line} strokeWidth={v === 0 ? 1.4 : 0.6} />
          <text x={L - 5} y={y(v) + 3.5} textAnchor="end" fontSize={10} fill={RC.muted}>{fmtSigned(v, 0)}</text>
        </g>
      ))}
      {LABELS.map(([f, s]) => (
        <g key={f}>
          <line x1={x(f)} x2={x(f)} y1={T} y2={H - B} stroke={RC.line} strokeWidth={0.6} />
          <text x={x(f)} y={H - 7} textAnchor="middle" fontSize={10} fill={RC.muted}>{s}</text>
        </g>
      ))}
      {phase === 'setup' && <path d={pathOf(() => 0)} fill="none" stroke={RC.primary} strokeWidth={2} />}
      {phase === 'profile' && <path d={pathOf(noiseProfileDb)} fill="none" stroke={RC.primary} strokeWidth={2} data-testid="fir-profile" />}
      {phase === 'reduce' && (
        <>
          <path d={pathOf(noiseProfileDb)} fill="none" stroke={RC.muted} strokeWidth={1.5} strokeDasharray="4 3" data-testid="fir-profile" />
          <path d={pathOf((f) => noiseProfileDb(f) - FIR_REDUCTION_DB)} fill="none" stroke={RC.primary} strokeWidth={2.2} data-testid="fir-lowered" />
          <text x={x(3000)} y={y(noiseProfileDb(3000)) - 8} fontSize={10} fill={RC.muted}>{t('replicas.fir.noiseProfile')}</text>
          <text x={x(3000)} y={y(noiseProfileDb(3000) - FIR_REDUCTION_DB) + 16} fontSize={10} fill={RC.primary}>{t('replicas.fir.lowered')}</text>
        </>
      )}
    </svg>
  )
}
