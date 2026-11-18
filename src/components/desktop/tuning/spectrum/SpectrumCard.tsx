import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { useTheme } from '@mui/material/styles'
import { useTranslation } from 'react-i18next'
import { Legend } from '../HistoryChart'
import type { ChainState } from '../useChainState'
import type { LiveEngine } from '../useLiveEngine'
import { BandFields } from './BandFields'
import { SpectrumPlot } from './SpectrumPlot'
import { ToneList } from './ToneList'
import { useSpectrumCard } from './useSpectrumCard'

/**
 * "Live spectrum" (SPEC "Live spectrum"): the mic alone and as heard, the first switched-on ReaEQ's curve with
 * draggable bands, and the steady tones with Cut. Only a hint while the engine is stopped.
 */
export function SpectrumCard({ engine, chain }: { engine: Pick<LiveEngine, 'state' | 'onFrame'>; chain: ChainState }) {
  const { t } = useTranslation()
  const theme = useTheme()
  const { palette } = theme.vars ?? theme
  const s = useSpectrumCard(engine, chain)
  const band = s.bands?.find((b) => b.n === s.selected) ?? null
  return (
    <Paper component="section" className="grid gap-2 p-4" aria-labelledby="tune-spectrum-title" data-testid="tune-spectrum">
      <Typography id="tune-spectrum-title" variant="h6" component="h2">{t('desktop.tune.spectrum.title')}</Typography>
      {!s.running ? (
        <Typography variant="body2" color="text.secondary" data-testid="spectrum-idle">{t('desktop.tune.spectrum.idle')}</Typography>
      ) : (
        <>
          {!s.slot && (
            <Typography variant="body2" color="text.secondary" data-testid="spectrum-no-eq">{t('desktop.tune.spectrum.noEq')}</Typography>
          )}
          <SpectrumPlot
            frame={s.frame}
            svg={s.svg}
            size={s.size}
            box={s.box}
            freqs={s.freqs}
            analyzer={s.feed.analyzer}
            tones={s.feed.tones}
            bands={s.bands}
            selected={s.selected}
            drag={s.drag}
          />
          <Legend
            items={[
              { label: t('desktop.tune.spectrum.legend.raw'), color: palette.text.secondary },
              { label: t('desktop.tune.spectrum.legend.processed'), color: palette.primary.main },
              { label: t('desktop.tune.spectrum.legend.eq'), color: palette.info.main },
              { label: t('desktop.tune.spectrum.legend.tone'), color: palette.warning.main, dashed: true },
            ]}
          />
          {band && s.slot && <BandFields band={band} switchable={`band${band.n}.on` in s.slot.values} onSet={s.drag.set} />}
          <ToneList rows={s.cuts.rows} listening={s.feed.listening} canCut={s.slot !== null} onCut={(r) => s.cuts.cut(r.tone)} onUndo={s.cuts.undo} />
        </>
      )}
    </Paper>
  )
}
