import Paper from '@mui/material/Paper'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { fmtDb, fmtDbfs, fmtNum } from '../../../i18n/format'
import type { SegmentSummary } from '../../../live/segments'
import { useMsg } from '../../common/MsgText'

const COLS = ['change', 'voice', 'pauses', 'peaks', 'dead'] as const

/** "Before and after each change": one row per segment (Start, then each change). */
export function SegmentsTable({ segments }: { segments: readonly SegmentSummary[] }) {
  const { t } = useTranslation()
  const tm = useMsg()
  return (
    <Paper component="section" className="grid gap-2 p-4" aria-labelledby="tune-seg-title" data-testid="tune-segments">
      <Typography id="tune-seg-title" variant="h6" component="h2">{t('desktop.tune.segments.title')}</Typography>
      {segments.length === 0 ? (
        <Typography variant="body2" color="text.secondary">{t('desktop.tune.segments.empty')}</Typography>
      ) : (
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                {COLS.map((c) => (
                  <TableCell key={c} align={c === 'change' ? 'left' : 'right'}>{t(`desktop.tune.segments.${c}`)}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {segments.map((s, i) => (
                <TableRow key={`${i}-${s.startT}`} data-testid="tune-segment-row">
                  <TableCell>{tm(s.label)}</TableCell>
                  <TableCell align="right">{fmtDbfs(s.fx.speechDb)}</TableCell>
                  <TableCell align="right">{fmtDb(s.fx.pauseDb, 0, false)}</TableCell>
                  <TableCell align="right">{fmtNum(s.fx.clipFrames, 0)}</TableCell>
                  <TableCell align="right">{t('desktop.tune.segments.pct', { v: fmtNum(s.fx.deadSilence * 100, 0) })}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Paper>
  )
}
