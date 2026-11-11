import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { useMsg } from '../../common/MsgText'
import { AdviceList } from './AdviceList'
import { ApplyFeedback } from './ApplyFeedback'
import { EffectsList } from './EffectsList'
import { HistoryChart } from './HistoryChart'
import { MetricCards } from './MetricCards'
import { MonitorAlert } from './MonitorAlert'
import { RestoreDialog } from './RestoreDialog'
import { SaveDialog } from './SaveDialog'
import { SegmentsTable } from './SegmentsTable'
import { TuningBar } from './TuningBar'
import { useTuningSession } from './useTuningSession'
import { YourSoundPanel } from './YourSoundPanel'

/** The live tuning screen (SPEC "Desktop app (v2.0)" → Live tuning screen, approved mockup), top to bottom. */
export function LiveTuning() {
  const { t } = useTranslation()
  const tm = useMsg()
  const s = useTuningSession()
  const { engine, chain, feedback } = s
  const running = engine.state === 'running'
  const rate = engine.status?.sampleRate ?? 48000
  const reafirOn = chain.model?.undo.chain.some((x) => x.kind === 'reafir' && x.on) ?? false
  const update = engine.update
  return (
    <div className="grid gap-4">
      <TuningBar
        devices={s.devices}
        state={engine.state}
        monitor={running ? (engine.status?.monitor ?? 'off') : null}
        onMonitor={(m) => void engine.setMonitor(m)}
        onStart={() => void s.start()}
        onStop={() => void engine.stop()}
      />
      <MonitorAlert delayMs={running ? engine.latencySamples / (rate / 1000) : null} reafirOn={reafirOn} />
      {s.error && (
        <Alert severity="error" onClose={() => s.setError(null)} data-testid="tune-error">{tm(s.error)}</Alert>
      )}
      {update ? (
        <MetricCards metrics={update.held} />
      ) : (
        <Typography color="text.secondary">{t(running ? 'desktop.tune.talk' : 'desktop.tune.idle')}</Typography>
      )}
      <HistoryChart history={update?.history ?? { points: [], markers: [] }} />
      <div className="grid items-start gap-4 md:grid-cols-2">
        <AdviceList
          advice={s.advice}
          applied={chain.applied}
          notice={chain.notice}
          hearsNothing={s.goal.perceived.length === 0}
          feedback={<ApplyFeedback pending={feedback.pending} leftMs={feedback.leftMs} onRate={feedback.rate} />}
          onApply={feedback.apply}
          onUndo={chain.undoApplied}
          onCloseNotice={chain.clearNotice}
        />
        <YourSoundPanel prefs={s.prefs.prefs} onPrefs={s.prefs.setPrefs} />
      </div>
      <EffectsList chain={chain} advice={s.advice} />
      <SegmentsTable segments={update?.segments ?? []} />
      {s.fileError && <Alert severity="warning">{t('desktop.tune.fileError', { reason: tm(s.fileError) })}</Alert>}
      <footer className="flex flex-wrap justify-end gap-2">
        <Button variant="outlined" onClick={() => void s.restore.open()}>{t('desktop.tune.restore')}</Button>
        <Button variant="contained" onClick={() => void s.save.open()} disabled={!chain.model?.entries || !chain.model.hash}>
          {t('desktop.tune.save')}
        </Button>
      </footer>
      <SaveDialog flow={s.save} model={chain.model} />
      <RestoreDialog flow={s.restore} />
    </div>
  )
}
