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
import { AbPlayer } from './AbPlayer'
import { AdjustPanel } from './AdjustPanel'
import { ChangesList } from './ChangesList'
import { MetricTable } from './MetricTable'
import { UnmetList } from './UnmetList'
import type { TuneSave } from './useTuneSave'

interface ResultStepProps {
  take: Float32Array
  result: TuneResult
  save: TuneSave
  onAdjust: (feedback: readonly Bother[] | 'tooProcessed') => void
  onRecordAgain: () => void
}

/** Step 4: Before / After on the same take, what changed and why, what it could not do; save, adjust or record again. */
export function ResultStep({ take, result, save, onAdjust, onRecordAgain }: ResultStepProps) {
  const { t } = useTranslation()
  const [adjusting, setAdjusting] = useState(false)
  const rows = useMemo(() => metricRows(result), [result])
  const none = result.changes.length === 0
  const nameOf = (i: number): string => canonicalName(save.entries.find((e) => e.index === i)?.name ?? '')
  return (
    <Paper component="section" className="grid gap-4 p-4" aria-labelledby="autotune-result-title">
      <Typography id="autotune-result-title" variant="h6" component="h2">{t('desktop.autotune.ui.result.title')}</Typography>
      {none && <Alert severity="success" data-testid="autotune-none">{t('desktop.autotune.ui.result.none')}</Alert>}
      <AbPlayer before={take} after={result.processed} />
      {rows.length > 0 && <MetricTable rows={rows} />}
      {!none && <ChangesList changes={result.changes} />}
      <UnmetList unmet={result.unmet} />
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
          <Button variant="outlined" onClick={() => setAdjusting(true)}>{t('desktop.autotune.ui.result.adjust')}</Button>
          <Button variant="contained" onClick={() => void save.flow.open()} disabled={none || save.saved}>
            {t('desktop.autotune.ui.result.save')}
          </Button>
        </div>
      )}
      <SaveDialog flow={save.flow} entries={save.entries} nameOf={nameOf} />
    </Paper>
  )
}
