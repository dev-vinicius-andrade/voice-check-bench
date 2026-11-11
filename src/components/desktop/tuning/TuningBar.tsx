import Button from '@mui/material/Button'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import type { AudioDevice, AudioMonitor } from '../../../desktop/types'
import type { DeviceChoice } from './useAudioDevices'
import type { EngineState } from './useLiveEngine'

const HEAR: readonly AudioMonitor[] = ['processed', 'raw', 'off']

function DevicePicker({ label, value, list, disabled, onChange, testId }: { label: string; value: string; list: AudioDevice[]; disabled: boolean; onChange: (id: string) => void; testId: string }) {
  return (
    <TextField select size="small" label={label} value={list.some((d) => d.id === value) ? value : ''} disabled={disabled} onChange={(e) => onChange(e.target.value)} sx={{ minWidth: 200 }} slotProps={{ htmlInput: { 'data-testid': testId } }}>
      {list.map((d) => (
        <MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>
      ))}
    </TextField>
  )
}

interface TuningBarProps {
  devices: DeviceChoice
  state: EngineState
  /** Engine monitor while running; null when stopped. */
  monitor: AudioMonitor | null
  onMonitor: (m: AudioMonitor) => void
  onStart: () => void
  onStop: () => void
}

/** Mic and headphones pickers, the "Hear" control (engine monitor) and Start/Stop. */
export function TuningBar({ devices, state, monitor, onMonitor, onStart, onStop }: TuningBarProps) {
  const { t } = useTranslation()
  const idle = state === 'idle'
  const list = devices.devices
  return (
    <Paper className="flex flex-wrap items-center gap-3 p-3" component="section" aria-label={t('desktop.tune.bar.label')}>
      <DevicePicker label={t('desktop.tune.bar.mic')} value={devices.inputId} list={list?.inputs ?? []} disabled={!idle || !list} onChange={devices.setInputId} testId="tune-mic" />
      <DevicePicker label={t('desktop.tune.bar.headphones')} value={devices.outputId} list={list?.outputs ?? []} disabled={!idle || !list} onChange={devices.setOutputId} testId="tune-headphones" />
      <div className="flex items-center gap-2">
        <Typography variant="body2" color="text.secondary" id="tune-hear">{t('desktop.tune.bar.hear')}</Typography>
        <ToggleButtonGroup
          exclusive
          size="small"
          aria-labelledby="tune-hear"
          value={monitor ?? 'off'}
          disabled={monitor === null}
          onChange={(_, v: AudioMonitor | null) => v && v !== monitor && onMonitor(v)}
        >
          {HEAR.map((m) => (
            <ToggleButton key={m} value={m}>{t(`desktop.tune.hear.${m}`)}</ToggleButton>
          ))}
        </ToggleButtonGroup>
      </div>
      <div className="ml-auto">
        {state === 'running' ? (
          <Button variant="outlined" onClick={onStop}>{t('desktop.tune.bar.stop')}</Button>
        ) : (
          <Button variant="contained" onClick={onStart} disabled={!idle || !list}>
            {state === 'starting' ? t('desktop.tune.bar.starting') : t('desktop.tune.bar.start')}
          </Button>
        )}
      </div>
    </Paper>
  )
}
