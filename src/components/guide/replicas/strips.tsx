// Layout pieces shared by the ReaComp / ReaGate replicas (same plugin family).
import Box from '@mui/material/Box'
import { Field, HSlider, VSlider } from './controls'
import { RC } from './replicaStyle'

interface Param {
  label: string
  /** Slider position 0..1. */
  pos: number
  /** Text in the value field; omitted for controls the step does not change. */
  value?: string
  unit?: string
  target?: string
}

/** Vertical slider with its label above and value field below (Threshold, Wet, Dry, Noise). */
export function VStrip({ label, pos, value, unit, target, height = 170 }: Param & { height?: number }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.75, minWidth: 64 }}>
      <Box component="span">{label}</Box>
      <VSlider pos={pos} height={height} />
      <Field value={value} target={target} width={60} />
      {unit && <Box component="span" sx={{ color: RC.muted }}>{unit}</Box>}
    </Box>
  )
}

/** Label · horizontal slider · value field · unit. */
export function ParamRow({ label, pos, value, unit, target, slider = 120 }: Param & { slider?: number }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 27 }}>
      <Box component="span" sx={{ width: 96, flex: 'none' }}>{label}</Box>
      <HSlider pos={pos} width={slider} />
      <Field value={value} target={target} width={56} />
      <Box component="span" sx={{ color: RC.muted, width: 20 }}>{unit}</Box>
    </Box>
  )
}

/** Label · value field · unit, no slider (Ratio, Knee size, Hysteresis, Lowpass…). */
export function FieldRow({ label, value, unit, target }: Omit<Param, 'pos'>) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 27 }}>
      <Box component="span" sx={{ width: 96, flex: 'none' }}>{label}</Box>
      <Field value={value} target={target} width={56} />
      <Box component="span" sx={{ color: RC.muted }}>{unit}</Box>
    </Box>
  )
}

/** Empty gain-reduction / level meter column. */
export function Meter({ height = 200 }: { height?: number }) {
  return <Box component="span" sx={{ width: 14, height, border: `1px solid ${RC.line}`, borderRadius: '2px', bgcolor: RC.panel, flex: 'none' }} />
}
