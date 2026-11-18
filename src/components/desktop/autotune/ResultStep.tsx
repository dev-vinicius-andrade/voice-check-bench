import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Link from '@mui/material/Link'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { metricRows } from '../../../desktop/autotune/results'
import type { Bother, TuneResult } from '../../../desktop/tune'
import { screenToHash } from '../../../hooks/useHashRoute'
import { canonicalName } from '../../../wavelink/plugins'
import { SaveDialog } from '../tuning/SaveDialog'
import { AbPlayerView } from './AbPlayer'
import { AdjustPanel } from './AdjustPanel'
import { ChangesList } from './ChangesList'
import { MetricTable } from './MetricTable'
import { TakeSpectrumCard } from './spectrum/TakeSpectrumCard'
import { UnmetList } from './UnmetList'
import { useAbPlayer } from './useAbPlayer'
import type { ManualEq } from './useManualEq'
import type { NoiseCut } from './useNoiseCut'
import type { TuneSave } from './useTuneSave'
import { useVoiceNoise } from './useVoiceNoise'

interface ResultStepProps {
  take: Float32Array
  /** What is heard and measured: the tune result, with the hand edits rendered when there are any. */
  result: TuneResult
  manual: ManualEq
  save: TuneSave
  /** "Cut the noise" (SPEC "Cut the noise"). */
  noise?: NoiseCut
  onAdjust: (feedback: readonly Bother[] | 'tooProcessed') => void
  onRecordAgain: () => void
}

/**
 * Step 4: Before / After on the same take, its spectrum with the ReaEQ to change by hand, what changed and why, what it
 * could not do; save, adjust or record again.
 */
export function ResultStep({ take, result, manual, save, noise, onAdjust, onRecordAgain }: ResultStepProps) {
  const { t } = useTranslation()
  const [adjusting, setAdjusting] = useState(false)
  const rows = useMemo(() => metricRows(result), [result])
  const none = result.changes.length === 0
  // a noise cut is something to save on its own: the session writes ReaFIR's loaded state
  const reafir = noise?.applied?.slot ?? null
  const stateKeys = useMemo(() => (reafir === null ? undefined : new Map([[reafir, 'desktop.save.noiseProfile']])), [reafir])
  const nothingToSave = none && manual.edits.length === 0 && !noise?.applied
  // voice and noise apart: "Noise only" in the player, "Voice and noise" and "In your noise" in the spectrum
  const voiceNoise = useVoiceNoise(take, result.processed)
  // one player for the controls and the spectrum (the plot follows where it is)
  const player = useAbPlayer(take, result.processed, voiceNoise.noise)
  const nameOf = (i: number): string => canonicalName(save.entries.find((e) => e.index === i)?.name ?? '')
  return (
    <Paper component="section" className="grid gap-4 p-4" aria-labelledby="autotune-result-title">
      <Typography id="autotune-result-title" variant="h6" component="h2">{t('desktop.autotune.ui.result.title')}</Typography>
      {none && <Alert severity="success" data-testid="autotune-none">{t('desktop.autotune.ui.result.none')}</Alert>}
      <AbPlayerView before={take} after={result.processed} p={player} />
      <TakeSpectrumCard take={take} processed={result.processed} manual={manual} player={player} voiceNoise={voiceNoise} noiseCut={noise} />
      {rows.length > 0 && <MetricTable rows={rows} />}
      {!none && <ChangesList changes={result.changes} edits={manual.edits} />}
      <UnmetList unmet={result.unmet} edited={manual.edits.length > 0} />
      {save.saved && (
        <Alert severity="success" data-testid="autotune-saved">
          {t('desktop.autotune.ui.result.saved')}{' '}
          <Link href={screenToHash('desktopLive')}>{t('desktop.autotune.ui.result.fineTune')}</Link>
          <Typography variant="body2" component="span" className="block" data-testid="autotune-calibrate-link">
            {t('desktop.autotune.ui.result.calibrateHint')}{' '}
            <Link href={screenToHash('desktopLive')}>{t('desktop.autotune.ui.result.calibrate')}</Link>
          </Typography>
        </Alert>
      )}
      {save.unchanged && (
        <Alert severity="info" data-testid="autotune-unchanged">
          {t('desktop.save.unchanged')}
        </Alert>
      )}
      {adjusting ? (
        <AdjustPanel
          onCancel={() => setAdjusting(false)}
          onRetune={(f) => {
            setAdjusting(false)
            onAdjust(f)
          }}
        />
      ) : (
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={onRecordAgain}>{t('desktop.autotune.ui.result.again')}</Button>
          <Button variant="outlined" onClick={() => setAdjusting(true)} disabled={manual.busy || !!noise?.busy}>{t('desktop.autotune.ui.result.adjust')}</Button>
          <Button variant="contained" onClick={() => void save.flow.open()} disabled={nothingToSave || save.saved || manual.busy || !!noise?.busy}>
            {t('desktop.autotune.ui.result.save')}
          </Button>
        </div>
      )}
      <SaveDialog flow={save.flow} entries={save.entries} nameOf={nameOf} stateKeys={stateKeys} />
    </Paper>
  )
}
