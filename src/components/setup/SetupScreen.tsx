import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import { TwoToneHeading } from '../common/TwoToneHeading'
import { useBench } from '../../store/benchStore'
import { useSlots } from '../../store/hooks'
import { isAnalysisError } from '../../types'
import { MicCard } from './MicCard'
import { SetupTakeList } from './SetupTakeList'

/** First screen: what the session records, mic permission and input choices. */
export function SetupScreen() {
  const micOn = useBench((s) => s.mic.status === 'on')
  const hasResults = useBench((s) => s.takes.some((t) => !isAnalysisError(t.analysis)))
  const valid = useSlots().map((t) => !!t && !isAnalysisError(t.analysis))
  const goTo = useBench((s) => s.goTo)
  const firstOpen = Math.max(0, valid.indexOf(false))

  return (
    <div className="mx-auto grid w-full max-w-[760px] gap-6">
      <div className="grid gap-3 text-center">
        <Typography variant="overline" color="primary" component="p" sx={{ lineHeight: 1.5 }}>
          Before you start
        </Typography>
        <TwoToneHeading first="Find out what's making" second="your voice unclear" variant="h4" />
        <Typography color="text.secondary" sx={{ maxWidth: '56ch', mx: 'auto', fontSize: 17 }}>
          You'll read the same short text four times. Three control takes on the raw mic at different distances, then one
          with your Wave Link effects. Takes are saved in this browser.
        </Typography>
      </div>
      <SetupTakeList />
      <MicCard />
      <div className="flex flex-wrap items-center justify-between gap-3">
        {hasResults ? (
          <Button variant="text" onClick={() => goTo('results')}>
            See previous results
          </Button>
        ) : (
          <span />
        )}
        <Button variant="contained" size="large" disabled={!micOn} onClick={() => goTo('step', firstOpen)}>
          Start step 1 →
        </Button>
      </div>
    </div>
  )
}
