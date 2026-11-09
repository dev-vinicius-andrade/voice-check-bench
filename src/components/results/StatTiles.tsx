import type { ReactNode } from 'react'
import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { countByStatus } from '../../audio/diagnose'
import type { Analysis, Check } from '../../types'

interface TileProps {
  label: string
  value: ReactNode
  unit: string
  bValue: string | null
}

function Tile({ label, value, unit, bValue }: TileProps) {
  return (
    <Paper className="min-w-0 px-3 py-2">
      <Typography variant="overline" color="text.secondary" component="div" sx={{ lineHeight: 1.6 }}>
        {label}
      </Typography>
      <Typography component="div" sx={{ fontSize: 20, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
        {value}
        <Typography component="small" variant="caption" color="text.secondary"> {unit}</Typography>
      </Typography>
      {bValue !== null && (
        <Typography variant="caption" component="div" color="info.main">B: {bValue}</Typography>
      )}
    </Paper>
  )
}

interface StatTilesProps {
  a: Analysis
  checks: readonly Check[]
  b: Analysis | null
  checksB: readonly Check[] | null
}

/** Speech, noise, SNR and issue counts for A, with B's value underneath. */
export function StatTiles({ a, checks, b, checksB }: StatTilesProps) {
  const n = countByStatus(checks)
  const nb = checksB ? countByStatus(checksB) : null
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Tile label="Speech" value={a.speechMed.toFixed(1)} unit="dBFS" bValue={b ? b.speechMed.toFixed(1) : null} />
      <Tile label="Noise" value={a.noise.toFixed(1)} unit="dBFS" bValue={b ? b.noise.toFixed(1) : null} />
      <Tile label="SNR" value={a.snr.toFixed(0)} unit="dB" bValue={b ? b.snr.toFixed(0) : null} />
      <Tile
        label="Issues"
        value={
          <>
            <Box component="span" sx={{ color: 'error.main' }}>{n.bad}</Box>
            {' · '}
            <Box component="span" sx={{ color: 'warning.main' }}>{n.warn}</Box>
          </>
        }
        unit="bad · warn"
        bValue={nb ? `${nb.bad} · ${nb.warn}` : null}
      />
    </div>
  )
}
