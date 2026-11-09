import type { VoiceStyle } from '../../types'
import { STYLE_OFFSETS } from '../../audio/reference'

const W = 96, H = 32, PAD = 4, RANGE = 3

/** Tiny curve sketch of a style's offset over the bands (flat line = natural). Decorative. */
export function StyleSketch({ style }: { style: VoiceStyle }) {
  const off = STYLE_OFFSETS[style]
  const step = (W - 2 * PAD) / (off.length - 1)
  const y = (v: number): number => H / 2 - (v / RANGE) * (H / 2 - PAD)
  const d = off.map((v, i) => `${i ? 'L' : 'M'}${PAD + i * step} ${y(v)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true" focusable="false" style={{ display: 'block' }}>
      <line x1={PAD} x2={W - PAD} y1={H / 2} y2={H / 2} stroke="var(--mui-palette-divider)" strokeDasharray="3 3" />
      <path d={d} fill="none" stroke="var(--mui-palette-primary-main)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
