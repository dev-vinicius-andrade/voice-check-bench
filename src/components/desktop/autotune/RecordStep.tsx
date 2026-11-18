import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import LinearProgress from '@mui/material/LinearProgress'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { MIN_STOP_SEC } from '../../../desktop/autotune/recorder'
import type { Msg } from '../../../plain/types'
import { useMsg } from '../../common/MsgText'
import type { DeviceChoice } from '../tuning/useAudioDevices'
import { RecordProgress } from './RecordProgress'
import type { TakeRecording } from './useTakeRecorder'

interface RecordStepProps {
  rec: TakeRecording
  devices: DeviceChoice
  deviceError: Msg | null
}

/** Step 1: pick the mic and record ~25 s of raw mic (or pick a WAV file); a take that fails the check asks again. */
export function RecordStep({ rec, devices, deviceError }: RecordStepProps) {
  const { t } = useTranslation()
  const tm = useMsg()
  const idle = rec.phase === 'idle'
  const recording = rec.phase === 'quiet' || rec.phase === 'talk'
  const inputs = devices.devices?.inputs ?? []
  const error = rec.error ?? deviceError
  return (
    <Paper component="section" className="grid gap-4 p-4" aria-labelledby="autotune-record-title">
      <div className="grid gap-1">
        <Typography id="autotune-record-title" variant="h6" component="h2">{t('desktop.autotune.ui.record.title')}</Typography>
        <Typography variant="body2" color="text.secondary">{t('desktop.autotune.ui.record.lead')}</Typography>
      </div>
      {error && <Alert severity="error" data-testid="autotune-record-error">{tm(error)}</Alert>}
      {rec.problem && idle && (
        <Alert severity="warning" data-testid="autotune-record-problem">{t(`desktop.autotune.ui.record.problem.${rec.problem}`)}</Alert>
      )}
      {recording && <RecordProgress seconds={rec.seconds} levelDb={rec.levelDb} talking={rec.phase === 'talk'} />}
      {rec.phase === 'checking' && (
        <div className="grid gap-2" role="status">
          <Typography>{t('desktop.autotune.ui.record.checking')}</Typography>
          <LinearProgress />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <TextField
          select
          size="small"
          label={t('desktop.autotune.ui.record.mic')}
          value={inputs.some((d) => d.id === devices.inputId) ? devices.inputId : ''}
          disabled={!idle || !devices.devices}
          onChange={(e) => devices.setInputId(e.target.value)}
          sx={{ minWidth: 220, maxWidth: '100%' }}
          slotProps={{ htmlInput: { 'data-testid': 'autotune-mic' } }}
        >
          {inputs.map((d) => (
            <MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>
          ))}
        </TextField>
        {recording ? (
          <Button variant="outlined" onClick={() => void rec.stop()} disabled={rec.seconds < MIN_STOP_SEC}>
            {t('desktop.autotune.ui.record.stop')}
          </Button>
        ) : (
          <Button variant="contained" onClick={() => void rec.start(devices.inputId)} disabled={!idle || !devices.devices}>
            {rec.phase === 'starting' ? t('desktop.autotune.ui.record.starting') : t(rec.problem ? 'desktop.autotune.ui.record.again' : 'desktop.autotune.ui.record.start')}
          </Button>
        )}
        {recording && rec.seconds < MIN_STOP_SEC && (
          <Typography variant="caption" color="text.secondary">{t('desktop.autotune.ui.record.stopHint', { sec: MIN_STOP_SEC })}</Typography>
        )}
      </div>
      {idle && (
        <div className="grid gap-1">
          <Typography variant="body2">{t('desktop.autotune.ui.record.or')}</Typography>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outlined" component="label">
              {t('desktop.autotune.ui.record.wav')}
              <input
                hidden
                type="file"
                accept=".wav,audio/wav,audio/x-wav"
                data-testid="autotune-wav"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (f) void rec.fromFile(f)
                }}
              />
            </Button>
            <Typography variant="caption" color="text.secondary">{t('desktop.autotune.ui.record.wavHint')}</Typography>
          </div>
        </div>
      )}
    </Paper>
  )
}
