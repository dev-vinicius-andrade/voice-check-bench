// Route #/live: listen to the raw mic and the Wave Link output together while changing settings (SPEC "Live tuning (v1.3)").
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { createLiveSession } from '../../live/LiveSession'
import type { HeldMetrics } from '../../live/hold'
import { PageColumn, PageHead } from '../pages/PageLayout'
import { ReadingText } from '../step/ReadingText'
import { HintsCard } from './HintsCard'
import { LiveDevicePickers } from './LiveDevicePickers'
import { LiveErrorAlert, LiveStatusChip, StartStopButton } from './LiveControls'
import { LoudnessCard } from './LoudnessCard'
import { PausesCard } from './PausesCard'
import { ToneCard } from './ToneCard'
import { useLiveDevices } from './useLiveDevices'
import { useLiveSession, type LiveSessionFactory } from './useLiveSession'

function LivePanels({ metrics }: { metrics: HeldMetrics }) {
  return (
    <div className="grid min-w-0 gap-4" data-testid="live-panels">
      <div className="grid min-w-0 gap-4 md:grid-cols-2">
        <LoudnessCard metrics={metrics} />
        <PausesCard metrics={metrics} />
      </div>
      <ToneCard metrics={metrics} />
      <HintsCard hints={metrics.hints} />
    </div>
  )
}

function ReadCard({ waiting }: { waiting: boolean }) {
  const { t } = useTranslation()
  return (
    <Paper className="grid min-w-0 gap-3 p-4" data-testid="live-read">
      {waiting && (
        <div className="grid gap-1" data-testid="live-read-prompt">
          <Typography variant="h6" component="h2">{t('live.read.title')}</Typography>
          <Typography variant="body2" color="text.secondary">{t('live.read.text')}</Typography>
        </div>
      )}
      <ReadingText />
    </Paper>
  )
}

export function LiveScreen({ createSession = createLiveSession }: { createSession?: LiveSessionFactory }) {
  const { t } = useTranslation()
  const live = useLiveSession(createSession)
  const devices = useLiveDevices()
  const { raw, fx } = devices.value
  const busy = live.status === 'running' || live.status === 'starting'
  const start = (): void => {
    if (fx) void live.start({ rawId: raw, fxId: fx })
  }
  const fxOnly = (): void => {
    devices.set('raw', null)
    if (fx) void live.start({ rawId: null, fxId: fx })
  }
  const running = live.status === 'running'
  return (
    <PageColumn>
      <div className="grid gap-3">
        <PageHead first={t('live.head.first')} second={t('live.head.second')} lead={t('live.head.lead')} />
        <Typography variant="body2" color="text.secondary" align="center" sx={{ maxWidth: '60ch', mx: 'auto' }}>
          {t('live.head.note')}
        </Typography>
      </div>
      <div className="grid min-w-0 gap-4">
        <Paper className="grid min-w-0 gap-3 p-4" data-testid="live-controls">
          <LiveDevicePickers api={devices} disabled={busy} />
          <div className="flex flex-wrap items-center gap-3">
            <StartStopButton status={live.status} canStart={fx !== null} onStart={start} onStop={live.stop} />
            {running && <LiveStatusChip metrics={live.metrics} fxOnly={raw === null} />}
          </div>
          {live.error && <LiveErrorAlert error={live.error} onFxOnly={fxOnly} />}
        </Paper>
        <ReadCard waiting={running && !live.metrics} />
        {running && live.metrics && <LivePanels metrics={live.metrics} />}
      </div>
    </PageColumn>
  )
}
