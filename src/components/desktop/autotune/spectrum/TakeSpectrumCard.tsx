import Alert from '@mui/material/Alert'
import Typography from '@mui/material/Typography'
import { useTheme } from '@mui/material/styles'
import { useTranslation } from 'react-i18next'
import { useMsg } from '../../../common/MsgText'
import { Legend } from '../../tuning/HistoryChart'
import { BandFields } from '../../tuning/spectrum/BandFields'
import { SpectrumPlot } from '../../tuning/spectrum/SpectrumPlot'
import { ToneList } from '../../tuning/spectrum/ToneList'
import type { ManualEq } from '../useManualEq'
import { ManualChanges } from './ManualChanges'
import { useTakeSpectrum, type PlayerAt } from './useTakeSpectrum'

interface TakeSpectrumCardProps {
  take: Float32Array
  /** The render that After plays. */
  processed: Float32Array
  manual: ManualEq
  player: PlayerAt
}

/**
 * "Spectrum" on the result step (SPEC "Tune from a recording — spectrum"): the take before and after, the first
 * switched-on ReaEQ's curve with draggable bands, the steady tones with Cut, and the hand changes with one Undo. A hand
 * change renders the take again; After then plays it.
 */
export function TakeSpectrumCard({ take, processed, manual, player }: TakeSpectrumCardProps) {
  const { t } = useTranslation()
  const tm = useMsg()
  const theme = useTheme()
  const { palette } = theme.vars ?? theme
  const s = useTakeSpectrum(take, processed, manual, player)
  const band = s.bands?.find((b) => b.n === s.selected) ?? null
  return (
    <section className="grid gap-2" aria-labelledby="autotune-spectrum-title" data-testid="take-spectrum">
      <Typography id="autotune-spectrum-title" variant="subtitle1" component="h3">{t('desktop.autotune.ui.spectrum.title')}</Typography>
      <Typography variant="body2" color="text.secondary">{t('desktop.autotune.ui.spectrum.help')}</Typography>
      {!s.slot && (
        <Typography variant="body2" color="text.secondary" data-testid="take-spectrum-no-eq">{t('desktop.autotune.ui.spectrum.noEq')}</Typography>
      )}
      <SpectrumPlot
        frame={s.frame}
        svg={s.svg}
        size={s.size}
        box={s.box}
        freqs={s.freqs}
        analyzer={s.analyzer}
        tones={s.tones}
        bands={s.bands}
        selected={s.selected}
        drag={s.drag}
        ariaKey="desktop.autotune.ui.spectrum.aria"
        readoutKey="desktop.autotune.ui.spectrum.readout"
      />
      <Legend
        items={[
          { label: t('desktop.autotune.ui.spectrum.legend.before'), color: palette.text.secondary },
          { label: t('desktop.autotune.ui.spectrum.legend.after'), color: palette.primary.main },
          { label: t('desktop.tune.spectrum.legend.eq'), color: palette.info.main },
          { label: t('desktop.tune.spectrum.legend.tone'), color: palette.warning.main, dashed: true },
        ]}
      />
      {manual.busy && (
        <Typography variant="body2" color="text.secondary" role="status" data-testid="take-spectrum-rendering">
          {t('desktop.autotune.ui.spectrum.rendering')}
        </Typography>
      )}
      {manual.error && (
        <Alert severity="error" data-testid="take-spectrum-error">{tm(manual.error)}</Alert>
      )}
      {band && s.slot && <BandFields band={band} switchable={`band${band.n}.on` in s.slot.values} onSet={s.drag.set} />}
      <ToneList rows={s.rows} listening={false} canCut={s.slot !== null} onCut={s.cut} onUndo={manual.undoCut} />
      <ManualChanges manual={manual} />
    </section>
  )
}
