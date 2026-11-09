import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { fmtDbfs } from '../../i18n/format'
import { useRoomLevel } from './useRoomLevel'

type Tone = 'success' | 'warning' | 'error'

/** Plain room reading from the 2 s minimum level: < -60 quiet, < -45 some noise, else noisy. */
function roomReading(db: number): { key: string; tone: Tone } {
  if (db < -60) return { key: 'wizard.room.quiet', tone: 'success' }
  if (db < -45) return { key: 'wizard.room.some', tone: 'warning' }
  return { key: 'wizard.room.noisy', tone: 'error' }
}

/** "Room: quiet / a little noisy / noisy" next to the live meter, from the quietest moment of the last 2 s. */
export function RoomReading() {
  const { t } = useTranslation()
  const room = useRoomLevel()
  const r = room === null ? null : roomReading(room)
  return (
    <Typography
      variant="body2"
      color="text.secondary"
      aria-live="polite"
      title={room === null ? undefined : t('wizard.room.detail', { level: fmtDbfs(room, 0) })}
    >
      {t('wizard.room.label')}{' '}
      {r ? (
        <Box component="b" sx={{ color: `${r.tone}.main`, fontWeight: 700 }}>
          {t(r.key)}
        </Box>
      ) : (
        t('wizard.room.measuring')
      )}
    </Typography>
  )
}
