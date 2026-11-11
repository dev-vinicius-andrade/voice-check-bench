import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { eqBands } from '../../../desktop/advice/chain'
import type { ChainSlot } from '../../../desktop/advice/types'
import type { SliderSpec } from '../../../desktop/sliderSpecs'
import { fmtHz } from '../../../i18n/format'
import { ParamSlider } from './ParamSlider'

interface SlotSlidersProps {
  slot: ChainSlot
  sliders: readonly SliderSpec[]
  onPreview: (key: string, v: number) => void
  onCommit: (key: string, v: number) => void
}

/** A slot's sliders; ReaEQ grouped per band (compact: gain and frequency). */
export function SlotSliders({ slot, sliders, onPreview, onCommit }: SlotSlidersProps) {
  const { t } = useTranslation()
  const one = (s: SliderSpec) => (
    <ParamSlider
      key={s.key}
      spec={s}
      label={s.label ?? t('desktop.tune.effects.strength')}
      value={slot.values[s.key]}
      onPreview={(v) => onPreview(s.key, v)}
      onCommit={(v) => onCommit(s.key, v)}
    />
  )
  if (slot.kind !== 'reaeq') return <div className="grid gap-1 pt-1">{sliders.map(one)}</div>
  return (
    <div className="grid gap-3 pt-1">
      {eqBands(slot).map((b) => (
        <div key={b.n} className="grid gap-0.5" data-testid={`tune-eq-band-${b.n}`}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
            {`Band ${b.n} · ${b.type === 'Other' ? '' : b.type} ${fmtHz(b.freqHz)}`.trim()}
            {!b.on && ` · ${t('desktop.tune.effects.off')}`}
          </Typography>
          {sliders.filter((s) => s.key.startsWith(`band${b.n}.`)).map(one)}
        </div>
      ))}
    </div>
  )
}
