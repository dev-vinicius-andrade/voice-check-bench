import LinearProgress from '@mui/material/LinearProgress'
import { useLevel } from '../../hooks/useLevel'

interface LevelMeterProps {
  /** CSS width of the bar. */
  width?: number | string
  /** Fixed level in dBFS; omit to follow the live input level. */
  db?: number
}

const FLOOR_DB = -60

const levelColor = (db: number): 'success' | 'warning' | 'error' => (db > -3 ? 'error' : db > -12 ? 'warning' : 'success')

/** Thin live input meter: -60 dBFS empty, 0 dBFS full; warning above -12, error above -3. */
export function LevelMeter({ width = 120, db }: LevelMeterProps) {
  const live = useLevel()
  const level = db ?? live
  const value = Math.min(100, Math.max(0, ((level - FLOOR_DB) / -FLOOR_DB) * 100))
  return (
    <LinearProgress
      variant="determinate"
      value={value}
      color={levelColor(level)}
      aria-hidden="true"
      sx={{
        width,
        maxWidth: '100%',
        height: 6,
        borderRadius: 999,
        '& .MuiLinearProgress-bar': { borderRadius: 999, transition: 'none' },
      }}
    />
  )
}
