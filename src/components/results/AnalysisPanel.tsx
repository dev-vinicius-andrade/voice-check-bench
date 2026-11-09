import { useMemo } from 'react'
import Alert from '@mui/material/Alert'
import AlertTitle from '@mui/material/AlertTitle'
import Chip from '@mui/material/Chip'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { NOT_ENOUGH_SPEECH_KEY } from '../../audio/analyze'
import { diagnose } from '../../audio/diagnose'
import { useBench } from '../../store/benchStore'
import { isAnalysisError, type Analysis, type ChartView, type Take } from '../../types'
import { BandChart } from './BandChart'
import { BeforeAfterCard } from './BeforeAfterCard'
import { ChecksList } from './ChecksList'
import { CompareTable } from './CompareTable'
import { CommunityMicCard } from './CommunityMicCard'
import { RoomNoisePanel } from './RoomNoisePanel'
import { StatTiles } from './StatTiles'
import { SummaryActions } from './SummaryActions'
import { SuggestedSettings } from './SuggestedSettings'
import { VerdictAlert } from './VerdictAlert'
import { useTakeB } from '../../store/hooks'
import { useTakeName } from './useTakeName'

function Who({ label, color, name }: { label: string; color: 'primary' | 'info'; name: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Chip label={label} color={color} size="small" />
      <Typography variant="body2" noWrap title={name} className="min-w-0">{name}</Typography>
    </span>
  )
}

function AnalysisBody({ A, a, b, view }: { A: Take; a: Analysis; b: Take | null; view: ChartView }) {
  const { t } = useTranslation()
  const checks = useMemo(() => diagnose(a), [a])
  const bAnalysis = b && !isAnalysisError(b.analysis) ? b.analysis : null
  const checksB = useMemo(() => (bAnalysis ? diagnose(bAnalysis) : null), [bAnalysis])
  return (
    <>
      <VerdictAlert analysis={a} checks={checks} />
      <StatTiles a={a} checks={checks} b={bAnalysis} checksB={checksB} />
      <RoomNoisePanel a={a} />
      <BeforeAfterCard A={A} />
      <CommunityMicCard A={A} />
      <BandChart a={a} b={bAnalysis} view={view} />
      <CompareTable A={A} B={b} />
      <ChecksList checks={checks} />
      <SuggestedSettings />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: '64ch' }}>
          {t('results.analysis.referenceNote')}
        </Typography>
        <SummaryActions A={A} />
      </div>
    </>
  )
}

export function AnalysisPanel({ A }: { A: Take }) {
  const { t } = useTranslation()
  const tn = useTakeName()
  const B = useTakeB()
  const storedView = useBench((s) => s.view)
  const setView = useBench((s) => s.setView)
  const okB = B && !isAnalysisError(B.analysis) ? B : null
  const view: ChartView = okB ? storedView : 'a'

  return (
    <section aria-label={t('results.analysis.aria')} className="grid min-w-0 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          <Who label="A" color="primary" name={tn(A)} />
          {B && <Who label="B" color="info" name={tn(B)} />}
        </div>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={view}
          aria-label={t('results.analysis.chartView')}
          onChange={(_e, v: ChartView | null) => v && setView(v)}
        >
          <ToggleButton value="a">A</ToggleButton>
          <ToggleButton value="ab" disabled={!okB}>A + B</ToggleButton>
          <ToggleButton value="diff" disabled={!okB}>A − B</ToggleButton>
        </ToggleButtonGroup>
      </div>
      {isAnalysisError(A.analysis) ? (
        <Alert severity="error">
          <AlertTitle>{t('results.analysis.error')}</AlertTitle>
          {t(NOT_ENOUGH_SPEECH_KEY)}
        </Alert>
      ) : (
        <AnalysisBody A={A} a={A.analysis} b={okB} view={view} />
      )}
    </section>
  )
}
