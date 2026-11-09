import { eqResponseDb, logFreqs, type EqCurveBand } from '../../../audio/eqCurve'
import { fmtSigned } from '../../../i18n/format'
import { RC } from './replicaStyle'

const W = 600, H = 220, L = 34, R = 34, T = 10, B = 22, LO = 20, HI = 20000, DB = 18
const PW = W - L - R
const x = (f: number): number => L + (Math.log(f / LO) / Math.log(HI / LO)) * PW
const y = (db: number): number => T + ((DB - Math.max(-DB, Math.min(DB, db))) / (2 * DB)) * (H - T - B)
const GRID_F = [1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((m) => [10, 100, 1000, 10000].map((d) => m * d)).filter((f) => f >= LO && f <= HI)
const LABELS: [number, string][] = [[50, '50'], [100, '100'], [200, '200'], [500, '500'], [1000, '1k'], [2000, '2k'], [5000, '5k'], [10000, '10k'], [20000, '20k']]
const GRID_DB = [-18, -12, -6, 0, 6, 12, 18]
const FREQS = logFreqs(240, LO, HI)
const r1 = (v: number): number => Math.round(v * 10) / 10

/** ReaEQ response graph: log grid 20 Hz–20 kHz, ±18 dB, the summed curve, numbered band nodes, master gain slider. */
export function EqGraph({ bands, active }: { bands: readonly EqCurveBand[]; active: number }) {
  const curve = eqResponseDb(bands, FREQS)
  const path = FREQS.map((f, i) => `${i ? 'L' : 'M'}${r1(x(f))},${r1(y(curve[i]))}`).join('')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', fontFamily: 'inherit' }} data-testid="eq-graph">
      <rect x={L} y={T} width={PW} height={H - T - B} fill={RC.surface} stroke={RC.line} />
      {GRID_F.map((f) => (
        <line key={f} x1={x(f)} x2={x(f)} y1={T} y2={H - B} stroke={RC.line} strokeWidth={0.6} />
      ))}
      {GRID_DB.map((v) => (
        <g key={v}>
          <line x1={L} x2={L + PW} y1={y(v)} y2={y(v)} stroke={RC.line} strokeWidth={v === 0 ? 1.4 : 0.6} />
          <text x={L - 5} y={y(v) + 3.5} textAnchor="end" fontSize={10} fill={RC.muted}>{fmtSigned(v, 0)}</text>
        </g>
      ))}
      {LABELS.map(([f, s]) => (
        <text key={f} x={x(f)} y={H - 7} textAnchor="middle" fontSize={10} fill={RC.muted}>{s}</text>
      ))}
      <path d={path} fill="none" stroke={RC.primary} strokeWidth={2.2} data-testid="eq-curve" />
      {bands.map((b, i) => {
        const on = i === active
        return (
          <g key={i} data-node={i + 1} data-active={on}>
            <circle cx={x(Math.max(LO, Math.min(HI, b.freq)))} cy={y(b.gain)} r={on ? 10 : 8} fill={on ? RC.primary : RC.panel} stroke={on ? RC.ink : RC.primary} strokeWidth={on ? 2 : 1.5} />
            <text x={x(Math.max(LO, Math.min(HI, b.freq)))} y={y(b.gain) + 3.5} textAnchor="middle" fontSize={on ? 11 : 10} fontWeight={700} fill={on ? RC.onPrimary : RC.ink}>
              {i + 1}
            </text>
          </g>
        )
      })}
      <g>
        <line x1={W - R / 2} x2={W - R / 2} y1={T} y2={H - B} stroke={RC.line} strokeWidth={4} strokeLinecap="round" />
        <rect x={W - R / 2 - 7} y={y(0) - 4} width={14} height={8} rx={2} fill={RC.ink} />
      </g>
    </svg>
  )
}
