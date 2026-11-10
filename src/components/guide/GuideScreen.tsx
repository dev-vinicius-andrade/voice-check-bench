// Route #/guide: "Set it up step by step" with the person's suggested settings, for the app they use (SPEC v0.7).
import { useMemo } from 'react'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { routeContext, routeToScreen } from '../../hooks/useHashRoute'
import { useBench } from '../../store/benchStore'
import { useSuggestion } from '../../store/hooks'
import { isAnalysisError, type Suggestion } from '../../types'
import { GuideLiveCta } from '../live/TuneLiveButton'
import { PageColumn, PageHead } from '../pages/PageLayout'
import { AppsGuide } from './AppsGuide'
import { HostPicker } from './HostPicker'
import { useHost, type Host } from './hostPref'
import { NvidiaGuide } from './NvidiaGuide'
import { ObsGuide } from './ObsGuide'
import { WaveLinkGuide } from './WaveLinkGuide'
import { overrideSuggestion, useGuideOverride } from './guideOverride'
import { RefinedBanner } from './RefinedBanner'

/** No suggestion yet: send people to the check (setup, or back to their step when the session has takes). */
function GuideEmpty() {
  const { t } = useTranslation()
  const hasTakes = useBench((s) => routeContext(s).hasSessionTakes)
  const open = (): void => {
    const st = useBench.getState()
    const target = routeToScreen('check', routeContext(st))
    if (target) st.goTo(target.screen, target.step)
  }
  return (
    <Paper className="grid justify-items-center gap-3 p-6 text-center" data-testid="guide-empty">
      <Typography variant="h6" component="h2">{t('guide.empty.title')}</Typography>
      <Typography color="text.secondary" sx={{ maxWidth: '50ch' }}>{t('guide.empty.text')}</Typography>
      <Button variant="contained" onClick={open}>{t(hasTakes ? 'guide.empty.finish' : 'guide.empty.start')}</Button>
    </Paper>
  )
}

function HostGuide({ host, s }: { host: Host; s: Suggestion }) {
  if (host === 'wavelink') return <WaveLinkGuide s={s} />
  if (host === 'obs') return <ObsGuide s={s} />
  if (host === 'nvidia') return <NvidiaGuide />
  if (host === 'apps' && !isAnalysisError(s.base.analysis)) return <AppsGuide s={s} a={s.base.analysis} />
  return null
}

export function GuideScreen() {
  const { t } = useTranslation()
  const ready = useBench((s) => s.ready)
  const suggestion = useSuggestion()
  const refined = useGuideOverride((x) => x.refined)
  // refined settings from the results ("I'll change them by hand") replace the suggestion's values
  const s = useMemo(() => (suggestion && refined ? overrideSuggestion(suggestion, refined) : suggestion), [suggestion, refined])
  const [host, setHost] = useHost()
  return (
    <PageColumn>
      <PageHead first={t('guide.head.first')} second={t('guide.head.second')} lead={t('guide.head.lead')} />
      {ready && !s && <GuideEmpty />}
      {s && (
        <div className="grid min-w-0 gap-6">
          <RefinedBanner />
          <HostPicker host={host} onPick={setHost} />
          {host && <HostGuide key={host} host={host} s={s} />}
          {host && <GuideLiveCta />}
        </div>
      )}
    </PageColumn>
  )
}
