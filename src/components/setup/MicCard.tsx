import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { LevelMeter } from '../common/LevelMeter'
import { DevicePickRow } from './DevicePickRow'
import { RoomReading } from './RoomReading'
import { useBench } from '../../store/benchStore'
import type { DeviceKind } from '../../types'

const PICKS: { kind: DeviceKind; title: string; hint: string }[] = [
  { kind: 'raw', title: 'Raw mic, no effects', hint: 'Steps 1–3 · the control takes' },
  { kind: 'fx', title: 'With your effects', hint: 'Step 4 · goes through Wave Link' },
]

/** Mic permission, then one row per device kind (select + Test); the row being listened to shows the meter. */
export function MicCard() {
  const mic = useBench((s) => s.mic)
  const deviceChoice = useBench((s) => s.deviceChoice)
  const enableMic = useBench((s) => s.enableMic)
  const on = mic.status === 'on'
  const listeningToPick = PICKS.some((p) => deviceChoice[p.kind] === mic.deviceId)

  return (
    <Paper className="grid gap-4 p-4 sm:p-5">
      <div className="grid justify-items-center gap-2 text-center">
        <Typography sx={{ fontWeight: 700 }}>Microphone access</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: '56ch' }}>
          {on
            ? 'Choose the input for each kind of take. The page switches between them on its own. Press Test and speak to check the meter.'
            : 'The browser asks once. Its own noise suppression and auto gain are turned off so you measure the real signal.'}
        </Typography>
        {!on && (
          <Button variant="contained" onClick={() => void enableMic()} disabled={mic.status === 'connecting'}>
            {mic.status === 'connecting' ? 'Connecting…' : 'Enable microphone'}
          </Button>
        )}
      </div>
      {on && PICKS.map((p) => <DevicePickRow key={p.kind} {...p} />)}
      {on && !listeningToPick && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
            Listening: <b>{mic.label || '—'}</b>
          </Typography>
          <LevelMeter />
          <RoomReading />
        </div>
      )}
    </Paper>
  )
}
