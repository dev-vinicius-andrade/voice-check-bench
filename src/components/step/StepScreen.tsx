import Alert from '@mui/material/Alert'
import Paper from '@mui/material/Paper'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { TwoToneHeading } from '../common/TwoToneHeading'
import { addressTip, placementTip } from '../../mics/catalog'
import { STEPS, fillDistance } from '../../session/steps'
import { useBench } from '../../store/benchStore'
import { useFxDist, useMicProfile, useStepTake } from '../../store/hooks'
import { DistanceRuler } from './DistanceRuler'
import { InputBar } from './InputBar'
import { ReadingText } from './ReadingText'
import { RecordButton } from './RecordButton'
import { RecordingCue } from './RecordingCue'
import { StepNav } from './StepNav'
import { TakeSummary } from './TakeSummary'

/** Splits a head after its last comma, else before its last two words: first line / accent line. */
function splitHead(head: string): [string, string] {
  const comma = head.lastIndexOf(',')
  if (comma > 0) return [head.slice(0, comma + 1), head.slice(comma + 1).trim()]
  const words = head.split(' ')
  if (words.length < 3) return [head, '']
  return [words.slice(0, -2).join(' '), words.slice(-2).join(' ')]
}

/** One guided recording step (or a free take): instructions, input, recorder and the take summary. */
export function StepScreen() {
  const step = useBench((s) => s.step)
  const fxDist = useFxDist()
  const take = useStepTake()
  const freeTakeName = useBench((s) => s.freeTakeName)
  const setFreeTakeName = useBench((s) => s.setFreeTakeName)
  const busy = useBench((s) => s.recorder.phase !== 'idle')
  const mic = useMicProfile()

  const st = typeof step === 'number' ? STEPS[step] : undefined
  const free = !st
  const [first, second] = st ? splitHead(fillDistance(st.head, fxDist)) : ['Record any setup', 'you want to test']
  const overline = st ? `Step ${(step as number) + 1} of ${STEPS.length} · ${st.kind}` : 'Free take'
  const lead = st
    ? fillDistance(st.lead, fxDist)
    : 'Pick the input below, name the take, and compare it with any other take afterwards.'
  const cm = st ? (st.cm ?? (Number.parseInt(fxDist, 10) || null)) : null

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
            {addressTip(mic)} {placementTip(mic)}
          </Alert>
        )}
      </div>
      {cm !== null && <DistanceRuler cm={cm} />}
      {free && (
        <TextField
          size="small"
          fullWidth
          value={freeTakeName}
          onChange={(e) => setFreeTakeName(e.target.value)}
          placeholder="Name this take, e.g. Processed · 8 cm · after EQ change"
          slotProps={{ htmlInput: { 'aria-label': 'Take name' } }}
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
