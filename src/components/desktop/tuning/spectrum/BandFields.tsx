import FormControlLabel from '@mui/material/FormControlLabel'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import type { EqField } from '../../../../desktop/advice/types'
import { EQ_LIMITS, type EqPoint } from '../../../../desktop/spectrum'
import { fmtInput } from '../../../../i18n/format'
import { clamp, snapGain } from './plotScale'

interface FieldSpec {
  field: Extract<EqField, 'freqHz' | 'gainDb' | 'bwOct'>
  label: string
  digits: number
  limits: readonly [number, number]
  fix: (v: number) => number
}

/** A number typed in any locale ("1,5" or "1.5"), clamped and fixed; null when it is not a number. */
const parse = (s: string, spec: FieldSpec): number | null => {
  const v = Number(s.trim().replace(',', '.'))
  return s.trim() !== '' && Number.isFinite(v) ? spec.fix(clamp(v, spec.limits)) : null
}

interface BandFieldsProps {
  band: EqPoint
  /** The band has its own On switch (band<n>.on). */
  switchable: boolean
  onSet: (n: number, field: EqField, value: number) => void
}

/** The selected band in one row: "Band 3 · Band", Frequency / Gain / Width fields (commit on blur or Enter), On. */
export function BandFields({ band, switchable, onSet }: BandFieldsProps) {
  const { t } = useTranslation()
  const specs: FieldSpec[] = [
    { field: 'freqHz', label: t('desktop.tune.spectrum.fields.freq'), digits: 0, limits: EQ_LIMITS.freqHz, fix: (v) => Math.round(v) },
    { field: 'gainDb', label: t('desktop.tune.spectrum.fields.gain'), digits: 1, limits: EQ_LIMITS.gainDb, fix: snapGain },
    { field: 'bwOct', label: t('desktop.tune.spectrum.fields.width'), digits: 2, limits: EQ_LIMITS.bwOct, fix: (v) => Math.round(v * 100) / 100 },
  ]
  const fixed = band.type === 'Other'
  return (
    <div className="flex flex-wrap items-center gap-3" data-testid="spectrum-band-fields">
      <Typography variant="body2" sx={{ fontWeight: 700 }}>
        {`${t('desktop.tune.spectrum.band', { n: band.n })} · ${band.type}`}
      </Typography>
      {specs.map((s) => {
        const shown = fmtInput(band[s.field], s.digits)
        const done = (el: HTMLInputElement): void => {
          const v = parse(el.value, s)
          if (v === null || Math.abs(v - band[s.field]) < 1e-6) el.value = shown
          else onSet(band.n, s.field, v)
        }
        return (
          <TextField
            // a new value from elsewhere (a drag, Undo) starts the field over
            key={`${band.n}:${s.field}:${shown}`}
            size="small"
            label={s.label}
            defaultValue={shown}
            disabled={fixed}
            slotProps={{ htmlInput: { inputMode: 'decimal', 'data-testid': `spectrum-field-${s.field}` } }}
            sx={{ width: '8.5rem' }}
            onBlur={(e) => done(e.target as HTMLInputElement)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') done(e.target as HTMLInputElement)
            }}
          />
        )
      })}
      {switchable && (
        <FormControlLabel
          control={<Switch size="small" checked={band.on} disabled={fixed} onChange={(e) => onSet(band.n, 'on', e.target.checked ? 1 : 0)} />}
          label={t('desktop.tune.spectrum.fields.on')}
        />
      )}
    </div>
  )
}
