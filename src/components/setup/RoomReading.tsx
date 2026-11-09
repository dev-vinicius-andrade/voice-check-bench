import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { useRoomLevel } from './useRoomLevel'

type Tone = 'success' | 'warning' | 'error'

/** Plain room reading from the 2 s minimum level: < -60 quiet, < -45 some noise, else noisy. */
function roomReading(db: number): { text: string; tone: Tone } {
  if (db < -60) return { text: 'quiet', tone: 'success' }
  if (db < -45) return { text: 'some noise', tone: 'warning' }
  return { text: 'noisy — the guide will adapt', tone: 'error' }
}

/** "Room: quiet / some noise / noisy" next to the live meter, from the quietest moment of the last 2 s. */
export function RoomReading() {
  const room = useRoomLevel()
  const r = room === null ? null : roomReading(room)
  return (
    <Typography
      variant="body2"
      color="text.secondary"
      aria-live="polite"
      title={room === null ? undefined : `Quietest level in the last 2 s: ${room.toFixed(0)} dBFS`}
    >
      Room:{' '}
      {r ? (
        <Box component="b" sx={{ color: `${r.tone}.main`, fontWeight: 700 }}>
          {r.text}
        </Box>
      ) : (
        'measuring…'
      )}
    </Typography>
  )
}
