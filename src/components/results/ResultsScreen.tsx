import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { useBench } from '../../store/benchStore'
import { useTakeA } from '../../store/hooks'
import { isAnalysisError } from '../../types'
import { TwoToneHeading } from '../common/TwoToneHeading'
import { AnalysisPanel } from './AnalysisPanel'
import { DemoBanner } from './DemoBanner'
import { PlainResults } from './PlainResults'
import { TakesPanel } from './TakesPanel'
import { useTakeName } from './useTakeName'

function NoResults() {
  const { t } = useTranslation()
  const goTo = useBench((s) => s.goTo)
  return (
    <Paper className="grid justify-items-start gap-3 p-6">
      <Typography variant="h5" component="h1">{t('results.empty.title')}</Typography>
      <Typography color="text.secondary">{t('results.empty.body')}</Typography>
      <Button variant="contained" onClick={() => goTo('step', 0)}>{t('results.empty.button')}</Button>
    </Paper>
  )
}

export function ResultsScreen() {
  const { t } = useTranslation()
  const tn = useTakeName()
  const A = useTakeA()
  let main = <NoResults />
  if (A && isAnalysisError(A.analysis)) {
    main = (
      <Paper className="p-4">
        <AnalysisPanel A={A} />
      </Paper>
    )
  } else if (A && !isAnalysisError(A.analysis)) {
    main = <PlainResults A={A} a={A.analysis} />
  }
  return (
    <div className="mx-auto grid w-full max-w-[1240px] gap-4 px-4 py-6">
      <DemoBanner />
      {A && <TwoToneHeading first={t('results.heading')} second={tn(A)} variant="h4" align="left" />}
      <div className="grid items-start gap-4 min-[980px]:grid-cols-[1fr_340px]">
        <div className="min-w-0">{main}</div>
        <TakesPanel />
      </div>
    </div>
  )
}
