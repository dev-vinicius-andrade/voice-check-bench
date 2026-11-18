import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import LinearProgress from '@mui/material/LinearProgress'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { STAGE_RENDERS, type TuneStage } from '../../../desktop/tune'
import { useMsg } from '../../common/MsgText'
import type { TuneRunState } from './useTuneRun'

type ShownStage = Exclude<TuneStage, 'baseline'>
const STAGES: readonly ShownStage[] = ['level', 'noise', 'tone', 'compression', 'trim']

interface TuningStepProps {
  state: TuneRunState
  onCancel: () => void
  onRetry: () => void
  onBack: () => void
}

/** Step 3: the five stages as Done / "Pass n of m…" / Waiting while tune() runs; an error in plain words with Try again. */
export function TuningStep({ state, onCancel, onRetry, onBack }: TuningStepProps) {
  const { t } = useTranslation()
  const tm = useMsg()
  const current = state.step === 'running' && state.stage && state.stage !== 'baseline' ? STAGES.indexOf(state.stage) : -1
  const statusOf = (s: ShownStage, i: number): string => {
    if (state.step !== 'running') return t('desktop.autotune.ui.tuning.waiting')
    if (i < current) return t('desktop.autotune.ui.tuning.done')
    if (i === current) return t('desktop.autotune.ui.tuning.pass', { n: Math.min(state.passes[s] ?? 1, STAGE_RENDERS[s]), of: STAGE_RENDERS[s] })
    return t('desktop.autotune.ui.tuning.waiting')
  }
  return (
    <Paper component="section" className="grid gap-4 p-4" aria-labelledby="autotune-tuning-title">
      <div className="grid gap-1">
        <Typography id="autotune-tuning-title" variant="h6" component="h2">{t('desktop.autotune.ui.tuning.title')}</Typography>
        <Typography variant="body2" color="text.secondary">{t('desktop.autotune.ui.tuning.lead')}</Typography>
      </div>
      {state.step === 'error' ? (
        <>
          <Alert severity="error" data-testid="autotune-tune-error">
            <Typography variant="subtitle2" component="p">{t('desktop.autotune.ui.tuning.failed')}</Typography>
            {tm(state.msg)}
          </Alert>
          <div className="flex flex-wrap justify-end gap-2">
            <Button onClick={onBack}>{t('desktop.autotune.ui.tuning.back')}</Button>
            <Button variant="contained" onClick={onRetry}>{t('desktop.autotune.ui.tuning.retry')}</Button>
          </div>
        </>
      ) : (
        <>
          <LinearProgress variant={current < 0 ? 'indeterminate' : 'determinate'} value={((current + 0.5) / STAGES.length) * 100} />
          {current < 0 && <Typography variant="body2" role="status">{t('desktop.autotune.ui.tuning.baseline')}</Typography>}
          <ol className="m-0 grid list-none gap-2 p-0" data-testid="autotune-stages">
            {STAGES.map((s, i) => (
              <li key={s} className="flex flex-wrap items-baseline justify-between gap-2" data-testid={`autotune-stage-${s}`}>
                <Typography sx={{ fontWeight: i === current ? 600 : 400 }}>{t(`desktop.autotune.ui.tuning.stages.${s}`)}</Typography>
                <Typography variant="body2" color={i < current ? 'success.main' : i === current ? 'text.primary' : 'text.secondary'}>
                  {statusOf(s, i)}
                </Typography>
              </li>
            ))}
          </ol>
          <div className="flex justify-end">
            <Button onClick={onCancel}>{t('desktop.autotune.ui.tuning.cancel')}</Button>
          </div>
        </>
      )}
    </Paper>
  )
}
