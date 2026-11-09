import { useTheme } from '@mui/material/styles'

interface DistanceRulerProps {
  /** Mouth-to-mic distance in cm (clamped to the 0–16 cm scale). */
  cm: number
}

const L = 60
const R = 360
const MAX_CM = 16
const TICKS = [0, 2, 4, 6, 8, 10, 12, 14, 16]
const xOf = (cm: number) => L + ((R - L) * Math.min(MAX_CM, Math.max(0, cm))) / MAX_CM

/** Mouth on the left, 0–16 cm scale, accent bar up to the mic. Ported from the prototype ruler. */
export function DistanceRuler({ cm }: DistanceRulerProps) {
  const theme = useTheme()
  // CSS variables follow the active light/dark scheme without re-rendering.
  const p = theme.vars?.palette ?? theme.palette
  const muted = p.text.secondary
  const line = p.divider
  const x = xOf(cm)
  return (
    <svg
      viewBox="0 0 420 64"
      aria-hidden="true"
      className="mx-auto block h-auto w-full max-w-[420px]"
      fontFamily={theme.typography.fontFamily}
    >
      <text x={L - 8} y={30} textAnchor="end" fontSize={13} fill={muted}>
        mouth
      </text>
      <line x1={L} x2={R} y1={40} y2={40} stroke={line} strokeWidth={2} />
      {TICKS.map((c) => (
        <g key={c}>
          <line x1={xOf(c)} x2={xOf(c)} y1={36} y2={44} stroke={line} />
          <text x={xOf(c)} y={58} textAnchor="middle" fontSize={10} fill={muted}>
            {c}
          </text>
        </g>
      ))}
      <circle cx={L} cy={40} r={6} fill={muted} />
      <line x1={L} x2={x} y1={40} y2={40} stroke={p.primary.main} strokeWidth={4} />
      <rect x={x - 7} y={22} width={14} height={36} rx={6} fill={p.text.primary} />
      <text x={x} y={15} textAnchor="middle" fontSize={13} fontWeight={700} fill={p.primary.main}>
        {cm} cm
      </text>
    </svg>
  )
}
