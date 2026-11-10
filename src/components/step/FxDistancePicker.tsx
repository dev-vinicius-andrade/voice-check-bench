import Alert from '@mui/material/Alert'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { fmtCm } from '../../i18n/format'
import { refDistance, sameDistance } from '../../session/distance'
import { STEPS } from '../../session/steps'
import { useBench } from '../../store/benchStore'
import { useFxDist } from '../../store/hooks'
import { stepDist } from './stepCopy'

/** The control distances (2 / 8 / 15 cm) the processed take can be recorded at. */
const CONTROLS = STEPS.flatMap((s) => (s.dist && s.cm !== null ? [{ dist: s.dist, cm: s.cm }] : []))

/**
 * Processed step: where the person is really recording (sets fxDist, so the take name, the ruler and the raw take it
 * is compared with follow). Warns when applied settings were made for another distance.
 */
export function FxDistancePicker() {
  const { t } = useTranslation()
  const fxDist = useFxDist()
  const setFxDist = useBench((s) => s.setFxDist)
  const applied = useBench((s) => s.applied)
  const busy = useBench((s) => s.recorder.phase !== 'idle')
  const made = applied ? refDistance(applied) : null
  const mismatch = made !== null && !sameDistance(made, fxDist)
  const label = (d: string): string => stepDist({ cm: null }, d)

  return (
    <div className="grid justify-items-center gap-2" data-testid="fx-distance-picker">
      <Typography id="fx-dist-label" variant="body2" sx={{ fontWeight: 600 }}>{t('wizard.fxDist.label')}</Typography>
      <ToggleButtonGroup
        size="small"
        exclusive
        value={fxDist}
        disabled={busy}
        onChange={(_e, d: string | null) => d && setFxDist(d)}
        aria-labelledby="fx-dist-label"
      >
        {CONTROLS.map((c) => (
          <ToggleButton key={c.dist} value={c.dist}>{fmtCm(c.cm)}</ToggleButton>
        ))}
      </ToggleButtonGroup>
      {mismatch && made && (
        <Alert severity="info" className="w-full" sx={{ maxWidth: '64ch', textAlign: 'left' }} data-testid="fx-distance-mismatch">
          {t('wizard.fxDist.mismatch', { dist: label(made), actual: label(fxDist) })}
        </Alert>
      )}
    </div>
  )
}
