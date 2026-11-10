import Alert from '@mui/material/Alert'
import Paper from '@mui/material/Paper'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { TwoToneHeading } from '../common/TwoToneHeading'
import { STEPS } from '../../session/steps'
import { useBench } from '../../store/benchStore'
import { useFxDist, useStepTake } from '../../store/hooks'
import { MicTips } from '../setup/MicTips'
import { DistanceRuler } from './DistanceRuler'
import { FxDistancePicker } from './FxDistancePicker'
import { InputBar } from './InputBar'
import { ReadingText } from './ReadingText'
import { RecordButton } from './RecordButton'
import { RecordingCue } from './RecordingCue'
import { StepNav } from './StepNav'
import { TakeSummary } from './TakeSummary'
import { stepCm } from './stepCopy'
import { useStepCopy } from './useStepCopy'

/** One guided recording step (or a free take): instructions, input, recorder and the take summary. */
export function StepScreen() {
  const { t } = useTranslation()
  const copyOf = useStepCopy()
  const step = useBench((s) => s.step)
  const fxDist = useFxDist()
  const take = useStepTake()
  const freeTakeName = useBench((s) => s.freeTakeName)
  const setFreeTakeName = useBench((s) => s.setFreeTakeName)
  const busy = useBench((s) => s.recorder.phase !== 'idle')

  const st = typeof step === 'number' ? STEPS[step] : undefined
  const free = !st
  const copy = st ? copyOf(st, fxDist) : null
  const first = copy ? copy.head1 : t('wizard.free.head1')
  const second = copy ? copy.head2 : t('wizard.free.head2')
  const overline = copy
    ? t('wizard.steps.overline', { n: (step as number) + 1, total: STEPS.length, kind: copy.kind })
    : t('wizard.free.overline')
  const lead = copy ? copy.lead : t('wizard.free.lead')
  const cm = st ? stepCm(st, fxDist) : null

  return (
    <div className="mx-auto grid w-full max-w-[760px] gap-6">
      <div className="grid gap-3 text-center">
        <Typography variant="overline" color="primary" component="p" sx={{ lineHeight: 1.5 }}>
          {overline}
        </Typography>
        <TwoToneHeading first={first} second={second || undefined} variant="h4" />
        <Typography color="text.secondary" sx={{ maxWidth: '56ch', mx: 'auto', fontSize: 17 }}>
          {lead}
        </Typography>
        {st?.dev === 'raw' && (
          <Alert severity="info" sx={{ maxWidth: '64ch', mx: 'auto', textAlign: 'left', py: 0 }}>
            <MicTips />
          </Alert>
        )}
      </div>
      {cm !== null && <DistanceRuler cm={cm} />}
      {st?.key === 'fx' && <FxDistancePicker />}
      {free && (
        <TextField
          size="small"
          fullWidth
          value={freeTakeName}
          onChange={(e) => setFreeTakeName(e.target.value)}
          placeholder={t('wizard.free.placeholder')}
          slotProps={{ htmlInput: { 'aria-label': t('wizard.free.nameLabel') } }}
          disabled={busy}
        />
      )}
      <InputBar key={String(step)} kind={st ? st.dev : null} />
      <Paper className="grid gap-5 p-4 sm:p-6">
        <RecordingCue />
        <ReadingText />
        <RecordButton hasTake={take !== null} />
      </Paper>
      {take && <TakeSummary take={take} />}
      <StepNav />
    </div>
  )
}
