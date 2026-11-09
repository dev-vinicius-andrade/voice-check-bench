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
import { useTranslation } from 'react-i18next'
import { fmtNum } from '../../i18n/format'
import type { CommunityMicStats } from '../../community/types'
import { fmtDistance, fmtNoisyShare, fmtSnr } from './communityFormat'

const COLUMNS = [
  { label: 'pages.community.col.reports', value: (m: CommunityMicStats) => fmtNum(m.reports, 0) },
  { label: 'pages.community.col.snr', value: fmtSnr },
  { label: 'pages.community.col.dist', value: fmtDistance },
  { label: 'pages.community.col.noisy', value: fmtNoisyShare },
] as const

const nums = { fontVariantNumeric: 'tabular-nums' } as const

function MicTable({ mics }: { mics: readonly CommunityMicStats[] }) {
  const { t } = useTranslation()
  return (
    <TableContainer component={Paper}>
      <Table size="small" aria-label={t('pages.community.tableLabel')}>
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 700 }}>{t('pages.community.col.mic')}</TableCell>
            {COLUMNS.map((c) => (
              <TableCell key={c.label} align="right" sx={{ fontWeight: 700 }}>
                {t(c.label)}
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
  const { t } = useTranslation()
  return (
    <ul className="m-0 grid list-none gap-3 p-0">
      {mics.map((m) => (
        <Paper component="li" key={m.key} className="grid gap-2 p-4">
          <Typography sx={{ fontWeight: 700 }}>{m.model}</Typography>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            {COLUMNS.map((c) => (
              <div key={c.label} className="contents">
                <Typography component="dt" variant="body2" color="text.secondary">
                  {t(c.label)}
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
