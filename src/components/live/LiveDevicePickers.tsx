import Button from '@mui/material/Button'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { useBench } from '../../store/benchStore'
import type { LiveDevicesApi } from './useLiveDevices'

const NONE = '__none__'

/** "Raw mic" (with a "None" choice) and "With effects (Wave Link)" selects; a mic button while no input is listed. */
export function LiveDevicePickers({ api, disabled }: { api: LiveDevicesApi; disabled: boolean }) {
  const { t } = useTranslation()
  const devices = useBench((s) => s.devices)
  const mic = useBench((s) => s.mic.status)
  const enableMic = useBench((s) => s.enableMic)
  const { value } = api

  if (devices.length === 0)
    return (
      <div className="grid justify-items-start gap-2">
        <Typography variant="body2" color="text.secondary">{t('live.devices.enable')}</Typography>
        <Button variant="outlined" onClick={() => void enableMic()} disabled={mic === 'connecting'}>
          {mic === 'connecting' ? t('common.actions.connecting') : t('common.actions.enableMic')}
        </Button>
      </div>
    )

  const options = devices.map((d) => (
    <MenuItem key={d.deviceId} value={d.deviceId}>{d.label}</MenuItem>
  ))
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <TextField
        select
        size="small"
        fullWidth
        label={t('live.devices.raw')}
        value={value.raw ?? NONE}
        disabled={disabled}
        onChange={(e) => api.set('raw', e.target.value === NONE ? null : e.target.value)}
        sx={{ minWidth: 0 }}
      >
        <MenuItem value={NONE}>{t('live.devices.none')}</MenuItem>
        {options}
      </TextField>
      <TextField
        select
        size="small"
        fullWidth
        label={t('live.devices.fx')}
        value={value.fx ?? ''}
        disabled={disabled}
        onChange={(e) => api.set('fx', e.target.value)}
        sx={{ minWidth: 0 }}
      >
        {options}
      </TextField>
    </div>
  )
}
