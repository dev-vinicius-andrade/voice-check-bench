import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { useBench } from '../../store/benchStore'
import { TwoToneHeading } from '../common/TwoToneHeading'
import { AnalysisPanel } from './AnalysisPanel'
import { DemoBanner } from './DemoBanner'
import { TakesPanel } from './TakesPanel'
import { shortName } from './download'
import { useTakeA } from '../../store/hooks'

function NoResults() {
  const goTo = useBench((s) => s.goTo)
  return (
    <Paper className="grid justify-items-start gap-3 p-6">
      <Typography variant="h5" component="h1">No takes yet</Typography>
      <Typography color="text.secondary">
        No analyzed takes yet. Go back to step 1 and record the control takes.
      </Typography>
      <Button variant="contained" onClick={() => goTo('step', 0)}>Go to step 1</Button>
    </Paper>
  )
}

export function ResultsScreen() {
  const A = useTakeA()
  return (
    <div className="mx-auto grid w-full max-w-[1240px] gap-4 px-4 py-6">
      <DemoBanner />
      {A && <TwoToneHeading first="Your results" second={shortName(A.name)} variant="h4" align="left" />}
      <div className="grid items-start gap-4 min-[980px]:grid-cols-[1fr_340px]">
        <div className="min-w-0">{A ? <AnalysisPanel A={A} /> : <NoResults />}</div>
        <TakesPanel />
      </div>
    </div>
  )
}
