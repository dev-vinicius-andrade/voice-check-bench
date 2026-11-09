import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { LevelMeter } from '../common/LevelMeter'
import { DevicePickRow } from './DevicePickRow'
import { RoomReading } from './RoomReading'
import { useBench } from '../../store/benchStore'
import type { DeviceKind } from '../../types'

const PICKS: { kind: DeviceKind }[] = [{ kind: 'raw' }, { kind: 'fx' }]

/** Mic permission, then one row per device kind (select + Test); the row being listened to shows the meter. */
export function MicCard() {
  const { t } = useTranslation()
  const mic = useBench((s) => s.mic)
  const deviceChoice = useBench((s) => s.deviceChoice)
  const enableMic = useBench((s) => s.enableMic)
  const on = mic.status === 'on'
  const listeningToPick = PICKS.some((p) => deviceChoice[p.kind] === mic.deviceId)

  return (
    <Paper className="grid gap-4 p-4 sm:p-5">
      <div className="grid justify-items-center gap-2 text-center">
        <Typography sx={{ fontWeight: 700 }}>{t('wizard.access.title')}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: '56ch' }}>
          {on ? t('wizard.access.leadOn') : t('wizard.access.leadOff')}
        </Typography>
        {!on && (
          <Button variant="contained" onClick={() => void enableMic()} disabled={mic.status === 'connecting'}>
            {mic.status === 'connecting' ? t('common.actions.connecting') : t('common.actions.enableMic')}
          </Button>
        )}
      </div>
      {on && PICKS.map((p) => <DevicePickRow key={p.kind} {...p} />)}
      {on && !listeningToPick && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
            {t('wizard.access.listening')} <b>{mic.label || '—'}</b>
          </Typography>
          <LevelMeter />
          <RoomReading />
        </div>
      )}
    </Paper>
  )
}
