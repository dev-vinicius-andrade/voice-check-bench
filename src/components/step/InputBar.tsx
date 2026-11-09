import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import { useState } from 'react'
import { DeviceSelect } from '../common/DeviceSelect'
import { LevelMeter } from '../common/LevelMeter'
import { useBench } from '../../store/benchStore'
import type { DeviceKind } from '../../types'

interface InputBarProps {
  /** Device kind of the current guided step; null for a free take (preview only, choices unchanged). */
  kind: DeviceKind | null
}

/** Current input, live meter and a Change toggle revealing the input select. */
export function InputBar({ kind }: InputBarProps) {
  const mic = useBench((s) => s.mic)
  const devices = useBench((s) => s.devices)
  const busy = useBench((s) => s.recorder.phase !== 'idle')
  const enableMic = useBench((s) => s.enableMic)
  const chooseDevice = useBench((s) => s.chooseDevice)
  const previewDevice = useBench((s) => s.previewDevice)
  const [open, setOpen] = useState(kind === null)
  const on = mic.status === 'on'

  const change = (id: string) => void (kind ? chooseDevice(kind, id) : previewDevice(id))

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
        <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
          Input:{' '}
          <Typography component="b" variant="inherit" color="text.primary" sx={{ fontWeight: 700 }}>
            {on ? mic.label || '—' : 'not connected'}
          </Typography>
        </Typography>
        <LevelMeter />
        {on ? (
          <Button variant="text" size="small" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            Change
          </Button>
        ) : (
          <Button variant="contained" size="small" onClick={() => void enableMic()} disabled={mic.status === 'connecting'}>
            {mic.status === 'connecting' ? 'Connecting…' : 'Enable microphone'}
          </Button>
        )}
      </div>
      {on && open && (
        <div className="mx-auto w-full max-w-[420px]">
          <DeviceSelect label="Input device" devices={devices} value={mic.deviceId} onChange={change} disabled={busy} />
        </div>
      )}
    </div>
  )
}
