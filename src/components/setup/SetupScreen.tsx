import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { TwoToneHeading } from '../common/TwoToneHeading'
import { useBench } from '../../store/benchStore'
import { useSlots } from '../../store/hooks'
import { isAnalysisError } from '../../types'
import { MicCard } from './MicCard'
import { MicProfileCard } from './MicProfileCard'
import { SetupTakeList } from './SetupTakeList'

/** First screen: what the session records, mic permission and input choices. */
export function SetupScreen() {
  const { t } = useTranslation()
  const micOn = useBench((s) => s.mic.status === 'on')
  const hasResults = useBench((s) => s.takes.some((t) => !isAnalysisError(t.analysis)))
  const valid = useSlots().map((t) => !!t && !isAnalysisError(t.analysis))
  const goTo = useBench((s) => s.goTo)
  const firstOpen = Math.max(0, valid.indexOf(false))

  return (
    <div className="mx-auto grid w-full max-w-[760px] gap-6">
      <div className="grid gap-3 text-center">
        <Typography variant="overline" color="primary" component="p" sx={{ lineHeight: 1.5 }}>
          {t('wizard.setup.overline')}
        </Typography>
        <TwoToneHeading first={t('wizard.setup.headFirst')} second={t('wizard.setup.headSecond')} variant="h4" />
        <Typography color="text.secondary" sx={{ maxWidth: '56ch', mx: 'auto', fontSize: 17 }}>
          {t('wizard.setup.lead')}
        </Typography>
      </div>
      <SetupTakeList />
      <MicProfileCard />
      <MicCard />
      <div className="flex flex-wrap items-center justify-between gap-3">
        {hasResults ? (
          <Button variant="text" onClick={() => goTo('results')}>
            {t('wizard.setup.previous')}
          </Button>
        ) : (
          <span />
        )}
        <Button variant="contained" size="large" disabled={!micOn} onClick={() => goTo('step', firstOpen)}>
          {t('wizard.setup.start')}
        </Button>
      </div>
    </div>
  )
}
