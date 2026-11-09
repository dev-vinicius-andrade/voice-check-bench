import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import type { InputDevice } from '../../audio/AudioEngine'

interface DeviceSelectProps {
  label: string
  devices: InputDevice[]
  value: string | null
  onChange: (deviceId: string) => void
  disabled?: boolean
}

/** Input device picker. Unknown or missing ids show as empty instead of an out-of-range value. */
export function DeviceSelect({ label, devices, value, onChange, disabled }: DeviceSelectProps) {
  const current = value && devices.some((d) => d.deviceId === value) ? value : ''
  return (
    <TextField
      select
      size="small"
      fullWidth
      label={label}
      value={current}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      sx={{ minWidth: 0 }}
    >
      {devices.length === 0 && (
        <MenuItem value="" disabled>
          No inputs found
        </MenuItem>
      )}
      {devices.map((d) => (
        <MenuItem key={d.deviceId} value={d.deviceId}>
          {d.label}
        </MenuItem>
      ))}
    </TextField>
  )
}
