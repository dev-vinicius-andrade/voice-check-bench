import Alert from '@mui/material/Alert'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import { useTheme } from '@mui/material/styles'
import { useTranslation } from 'react-i18next'
import { useMsg } from '../../../common/MsgText'
import { Legend } from '../../tuning/HistoryChart'
import { BandFields } from '../../tuning/spectrum/BandFields'
import { SpectrumPlot } from '../../tuning/spectrum/SpectrumPlot'
import { ToneList } from '../../tuning/spectrum/ToneList'
import type { ManualEq } from '../useManualEq'
import type { NoiseCut } from '../useNoiseCut'
import type { TakeVoiceNoise } from '../useVoiceNoise'
import { ManualChanges } from './ManualChanges'
import { NoiseCutPanel } from './NoiseCutPanel'
import { NoiseRegions } from './NoiseRegions'
import { useSpectrumView, type SpectrumView } from './useSpectrumView'
import { useTakeSpectrum, type PlayerAt } from './useTakeSpectrum'

interface TakeSpectrumCardProps {
  take: Float32Array
  /** The render that After plays. */
  processed: Float32Array
  manual: ManualEq
  player: PlayerAt
  voiceNoise: TakeVoiceNoise
  /** "Cut the noise", under "In your noise". */
  noiseCut?: NoiseCut
}

/**
 * "Spectrum" on the result step (SPEC "Tune from a recording — spectrum"): the take before and after, the first
 * switched-on ReaEQ's curve with draggable bands, the steady tones with Cut, and the hand changes with one Undo. A hand
 * change renders the take again; After then plays it. With noise stretches (SPEC "… — voice and noise"): "Voice and
 * noise" of the player's side instead of the whole recording, and "In your noise" under the tones, with "Cut the
 * noise" (SPEC "Cut the noise") under it.
 */
export function TakeSpectrumCard({ take, processed, manual, player, voiceNoise, noiseCut }: TakeSpectrumCardProps) {
  const { t } = useTranslation()
  const tm = useMsg()
  const theme = useTheme()
  const { palette } = theme.vars ?? theme
  const s = useTakeSpectrum(take, processed, manual, player)
  const v = useSpectrumView(voiceNoise, player.side, s.analyzer, s.tones)
  const split = v.view === 'voiceNoise'
  const band = s.bands?.find((b) => b.n === s.selected) ?? null
  const L = 'desktop.autotune.ui.spectrum.legend'
  return (
    <section className="grid gap-2" aria-labelledby="autotune-spectrum-title" data-testid="take-spectrum">
      <Typography id="autotune-spectrum-title" variant="subtitle1" component="h3">{t('desktop.autotune.ui.spectrum.title')}</Typography>
      <Typography variant="body2" color="text.secondary">{t('desktop.autotune.ui.spectrum.help')}</Typography>
      {!s.slot && (
        <Typography variant="body2" color="text.secondary" data-testid="take-spectrum-no-eq">{t('desktop.autotune.ui.spectrum.noEq')}</Typography>
      )}
      {v.available && (
        <ToggleButtonGroup exclusive size="small" className="justify-self-start" value={v.view} aria-label={t('desktop.autotune.ui.spectrum.view.label')} onChange={(_, x: SpectrumView | null) => x && v.setView(x)}>
          <ToggleButton value="whole">{t('desktop.autotune.ui.spectrum.view.whole')}</ToggleButton>
          <ToggleButton value="voiceNoise">{t('desktop.autotune.ui.spectrum.view.voiceNoise')}</ToggleButton>
        </ToggleButtonGroup>
      )}
      <SpectrumPlot
        frame={s.frame}
        svg={s.svg}
        size={s.size}
        box={s.box}
        freqs={s.freqs}
        analyzer={v.analyzer}
        tones={s.tones}
        bands={s.bands}
        selected={s.selected}
        drag={s.drag}
        ariaKey={split ? 'desktop.autotune.ui.spectrum.voiceNoise.aria' : 'desktop.autotune.ui.spectrum.aria'}
        readoutKey={split ? 'desktop.autotune.ui.spectrum.voiceNoise.readout' : 'desktop.autotune.ui.spectrum.readout'}
        rawLine={split ? 'error.main' : 'text.secondary'}
      />
      <Legend
        items={[
          split ? { label: t(`${L}.voice`), color: palette.primary.main } : { label: t(`${L}.before`), color: palette.text.secondary },
          split ? { label: t(`${L}.noise`), color: palette.error.main } : { label: t(`${L}.after`), color: palette.primary.main },
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
      {voiceNoise.before && voiceNoise.after && <NoiseRegions before={voiceNoise.before} after={voiceNoise.after} />}
      {voiceNoise.before && voiceNoise.after && noiseCut && <NoiseCutPanel cut={noiseCut} />}
      <ManualChanges manual={manual} />
    </section>
  )
}
