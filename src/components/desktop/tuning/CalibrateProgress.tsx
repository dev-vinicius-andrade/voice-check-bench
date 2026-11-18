import LinearProgress from '@mui/material/LinearProgress'
import Step from '@mui/material/Step'
import StepLabel from '@mui/material/StepLabel'
import Stepper from '@mui/material/Stepper'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import type { CalView } from '../../../desktop/calibrate/types'
import { fmtDbfs, fmtNum } from '../../../i18n/format'
import { LevelMeter } from '../../common/LevelMeter'
import { useMsg } from '../../common/MsgText'

const PHASES = ['quiet', 'set', 'talk'] as const

/** While calibrating: the three phases, what to do now, progress and countdown, the mic level and the pauses as heard. */
export function CalibrateProgress({ view }: { view: CalView }) {
  const { t } = useTranslation()
  const tm = useMsg()
  const step = view.phase === 'verify' ? 2 : PHASES.indexOf(view.phase as (typeof PHASES)[number])
  const waiting = !Number.isFinite(view.progress)
  return (
    <div className="grid gap-3" data-testid="tune-calibrate-progress">
      <Stepper activeStep={step} aria-label={t('desktop.tune.calibrate.phases')}>
        {PHASES.map((p) => (
          <Step key={p}>
            <StepLabel>{t(`desktop.tune.calibrate.phase.${p}`)}</StepLabel>
          </Step>
        ))}
      </Stepper>
      {view.instruction && (
        <Typography variant="h6" component="p" role="status" data-testid="tune-calibrate-do">
          {tm(view.instruction)}
        </Typography>
      )}
      {view.detail && (
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          {t('desktop.tune.calibrate.trying', { change: tm(view.detail) })}
        </Typography>
      )}
      <div className="grid gap-1">
        <LinearProgress variant={waiting ? 'indeterminate' : 'determinate'} value={waiting ? undefined : view.progress * 100} aria-label={t('desktop.tune.calibrate.progress')} />
        <Typography variant="caption" color="text.secondary" data-testid="tune-calibrate-left">
          {waiting ? t('desktop.tune.calibrate.settling') : Number.isFinite(view.leftSec) ? t('desktop.tune.calibrate.left', { sec: fmtNum(Math.ceil(view.leftSec), 0) }) : t('desktop.tune.calibrate.measuring')}
        </Typography>
      </div>
      <div className="grid items-center gap-x-3 gap-y-1 sm:grid-cols-[auto_1fr_auto]">
        <Typography variant="body2" color="text.secondary">{t('desktop.tune.calibrate.mic')}</Typography>
        <LevelMeter db={view.rawDb} width="100%" />
        <Typography variant="body2" color="text.secondary">{fmtDbfs(view.rawDb)}</Typography>
        <Typography variant="body2" color="text.secondary">{t('desktop.tune.calibrate.heard')}</Typography>
        <LevelMeter db={view.processedDb} width="100%" />
        <Typography variant="body2" color="text.secondary" data-testid="tune-calibrate-heard">{fmtDbfs(view.processedDb)}</Typography>
      </div>
    </div>
  )
}
