import Paper from '@mui/material/Paper'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import type { Theme } from '@mui/material/styles'
import type { CommunityMicStats } from '../../community/types'
import { fmtDistance, fmtNoisyShare, fmtSnr } from './communityFormat'

const COLUMNS = [
  { label: 'Reports', value: (m: CommunityMicStats) => String(m.reports) },
  { label: 'Typical raw SNR', value: fmtSnr },
  { label: 'Most voted distance', value: fmtDistance },
  { label: 'Noisy rooms', value: fmtNoisyShare },
] as const

const nums = { fontVariantNumeric: 'tabular-nums' } as const

function MicTable({ mics }: { mics: readonly CommunityMicStats[] }) {
  return (
    <TableContainer component={Paper}>
      <Table size="small" aria-label="Shared results per mic model">
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 700 }}>Mic</TableCell>
            {COLUMNS.map((c) => (
              <TableCell key={c.label} align="right" sx={{ fontWeight: 700 }}>
                {c.label}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {mics.map((m) => (
            <TableRow key={m.key} sx={{ '&:last-child td': { borderBottom: 0 } }}>
              <TableCell component="th" scope="row" sx={{ fontWeight: 600 }}>
                {m.model}
              </TableCell>
              {COLUMNS.map((c) => (
                <TableCell key={c.label} align="right" sx={nums}>
                  {c.value(m)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  )
}

function MicCards({ mics }: { mics: readonly CommunityMicStats[] }) {
  return (
    <ul className="m-0 grid list-none gap-3 p-0">
      {mics.map((m) => (
        <Paper component="li" key={m.key} className="grid gap-2 p-4">
          <Typography sx={{ fontWeight: 700 }}>{m.model}</Typography>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            {COLUMNS.map((c) => (
              <div key={c.label} className="contents">
                <Typography component="dt" variant="body2" color="text.secondary">
                  {c.label}
                </Typography>
                <Typography component="dd" variant="body2" align="right" sx={{ m: 0, ...nums }}>
                  {c.value(m)}
                </Typography>
              </div>
            ))}
          </dl>
        </Paper>
      ))}
    </ul>
  )
}

/** Mic models as a table on ≥ 600 px, as cards below. */
export function CommunityMicList({ mics }: { mics: readonly CommunityMicStats[] }) {
  const wide = useMediaQuery((t: Theme) => t.breakpoints.up('sm'))
  return wide ? <MicTable mics={mics} /> : <MicCards mics={mics} />
}
