import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Typography from '@mui/material/Typography'
import { DeviceSelect } from '../common/DeviceSelect'
import { LevelMeter } from '../common/LevelMeter'
import { useBench } from '../../store/benchStore'
import { RoomReading } from './RoomReading'
import type { DeviceKind } from '../../types'

interface DevicePickRowProps {
  kind: DeviceKind
  title: string
  hint: string
}

/** One input choice on its own row: title + hint, full-width select with Test, live meter when it is the open input. */
export function DevicePickRow({ kind, title, hint }: DevicePickRowProps) {
  const devices = useBench((s) => s.devices)
  const choice = useBench((s) => s.deviceChoice[kind])
  const listening = useBench((s) => s.mic.status === 'on' && s.mic.deviceId === choice && choice !== null)
  const chooseDevice = useBench((s) => s.chooseDevice)
  const previewDevice = useBench((s) => s.previewDevice)

  return (
    <Box
      className="grid gap-2 p-3 text-left"
      sx={{ border: 1, borderColor: listening ? 'primary.main' : 'divider', borderRadius: 2.5 }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <Typography sx={{ fontWeight: 700 }}>{title}</Typography>
          <Typography variant="caption" color="text.secondary">
            {hint}
          </Typography>
        </div>
        {listening && <Chip size="small" color="primary" label="Listening" />}
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1">
          <DeviceSelect label="Input" devices={devices} value={choice} onChange={(id) => void chooseDevice(kind, id)} />
        </div>
        <Button
          variant="outlined"
          size="small"
          title="Open this input and watch the meter"
          disabled={!choice || listening}
          onClick={() => choice && void previewDevice(choice)}
        >
          Test
        </Button>
      </div>
      {listening && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <div className="min-w-[120px] flex-1">
            <LevelMeter width="100%" />
          </div>
          <RoomReading />
        </div>
      )}
    </Box>
  )
}
