import Slider from '@mui/material/Slider'
import Typography from '@mui/material/Typography'
import { useId, useState } from 'react'
import { fromPos, toPos, type SliderSpec } from '../../../desktop/sliderSpecs'
import { fmtSlider } from './sliderFormat'

interface ParamSliderProps {
  spec: SliderSpec
  label: string
  value: number
  disabled?: boolean
  /** While dragging (the caller throttles what goes to the engine). */
  onPreview: (v: number) => void
  /** Released: the final value. */
  onCommit: (v: number) => void
}

/** One plugin value: label, slider (log scale for frequency and ratio), value in its unit. */
export function ParamSlider({ spec, label, value, disabled, onPreview, onCommit }: ParamSliderProps) {
  const id = useId()
  const [drag, setDrag] = useState<number | null>(null)
  const shown = drag ?? value
  const num = (p: number | number[]): number => fromPos(spec, Array.isArray(p) ? p[0] : p)
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)_5.5rem] items-center gap-3">
      <Typography variant="body2" id={id} sx={{ overflowWrap: 'anywhere' }}>{label}</Typography>
      <Slider
        size="small"
        aria-labelledby={id}
        disabled={disabled}
        min={toPos(spec, spec.min)}
        max={toPos(spec, spec.max)}
        step={spec.log ? 0.001 : spec.step}
        value={toPos(spec, Math.min(spec.max, Math.max(spec.min, shown)))}
        getAriaValueText={() => fmtSlider(spec, shown)}
        onChange={(_, p) => {
          const v = num(p)
          setDrag(v)
          onPreview(v)
        }}
        onChangeCommitted={(_, p) => {
          setDrag(null)
          onCommit(num(p))
        }}
      />
      <Typography variant="body2" align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{fmtSlider(spec, shown)}</Typography>
    </div>
  )
}
