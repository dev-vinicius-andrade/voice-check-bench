import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { DeviceSelect } from '../common/DeviceSelect'
import { LevelMeter } from '../common/LevelMeter'
import { useBench } from '../../store/benchStore'
import type { DeviceKind } from '../../types'

const PICKS: { kind: DeviceKind; label: string }[] = [
  { kind: 'raw', label: 'Raw mic, no effects · steps 1–3' },
  { kind: 'fx', label: 'With your effects · step 4' },
]

/** Mic permission, then one input per device kind with a Test button and the live meter. */
export function MicCard() {
  const mic = useBench((s) => s.mic)
  const devices = useBench((s) => s.devices)
  const deviceChoice = useBench((s) => s.deviceChoice)
  const enableMic = useBench((s) => s.enableMic)
  const chooseDevice = useBench((s) => s.chooseDevice)
  const previewDevice = useBench((s) => s.previewDevice)
  const on = mic.status === 'on'

  return (
    <Paper className="grid justify-items-center gap-3 p-4 text-center sm:p-5">
      <Typography sx={{ fontWeight: 700 }}>Microphone access</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: '56ch' }}>
        {on
          ? 'Choose which input to use for each kind of take. The page switches between them on its own. Speak and watch the meter to check.'
          : 'The browser asks once. Its own noise suppression and auto gain are turned off so you measure the real signal.'}
      </Typography>
      {!on && (
        <Button variant="contained" onClick={() => void enableMic()} disabled={mic.status === 'connecting'}>
          {mic.status === 'connecting' ? 'Connecting…' : 'Enable microphone'}
        </Button>
      )}
      {on && (
        <div className="grid w-full gap-4 text-left sm:grid-cols-2">
          {PICKS.map(({ kind, label }) => (
            <div key={kind} className="flex min-w-0 items-center gap-2">
              <div className="min-w-0 flex-1">
                <DeviceSelect
                  label={label}
                  devices={devices}
                  value={deviceChoice[kind]}
                  onChange={(id) => void chooseDevice(kind, id)}
                />
              </div>
              <Button
                variant="outlined"
                size="small"
                title="Listen on the meter"
                disabled={!deviceChoice[kind]}
                onClick={() => {
                  const id = deviceChoice[kind]
                  if (id) void previewDevice(id)
                }}
              >
                Test
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 sm:col-span-2">
            <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
              Listening:{' '}
              <Typography component="b" variant="inherit" color="text.primary" sx={{ fontWeight: 700 }}>
                {mic.label || '—'}
              </Typography>
            </Typography>
            <LevelMeter />
          </div>
        </div>
      )}
    </Paper>
  )
}
