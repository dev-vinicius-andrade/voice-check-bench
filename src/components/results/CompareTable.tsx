import { useMemo } from 'react'
import Chip from '@mui/material/Chip'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import { countByStatus, diagnose, f1 } from '../../audio/diagnose'
import { BANDS, deviations } from '../../audio/reference'
import { isAnalysisError, type Analysis, type Check, type CheckId, type Status, type Take } from '../../types'
import { useBench } from '../../store/benchStore'
import { shortName } from './download'
import { useBestControl, useSlots } from '../../store/hooks'

interface Row {
  label: string
  id: CheckId | null
  value: (a: Analysis, checks: Check[]) => string
}

const BAND_IDS: CheckId[] = ['boom', 'warmth', 'mud', 'body', 'definition', 'presence', 'sibilance', 'air']

const ROWS: Row[] = [
  { label: 'Speech level', id: 'level', value: (a) => a.speechMed.toFixed(1) },
  { label: 'Noise floor', id: 'noise', value: (a) => a.noise.toFixed(0) },
  { label: 'SNR', id: 'noise', value: (a) => a.snr.toFixed(0) },
  ...BAND_IDS.map((id, k): Row => ({
    label: `${BANDS[k + 1].label} ${BANDS[k + 1].name}`,
    id,
    value: (a) => f1(deviations(a.rel)[k + 1]),
  })),
  { label: 'Consistency', id: 'consistency', value: (a) => a.spread.toFixed(1) },
  { label: 'Problems (bad · warn)', id: null, value: (_a, c) => { const n = countByStatus(c); return `${n.bad} · ${n.warn}` } },
]

const STATUS_SX: Record<Status, object> = {
  good: { color: 'success.main' },
  warn: { color: 'warning.main' },
  bad: { color: 'error.main', fontWeight: 700 },
}

interface Col { take: Take; a: Analysis; checks: Check[] }

/** Session takes (or A and B) side by side, cells coloured by the matching check (prototype renderCompare). */
export function CompareTable({ A, B }: { A: Take; B: Take | null }) {
  const slots = useSlots(A.session)
  const best = useBestControl(A.session)
  const idA = useBench((s) => s.A)
  const idB = useBench((s) => s.B)
  const cols = useMemo((): Col[] | null => {
    const toCols = (takes: (Take | null)[]): Col[] =>
      takes.flatMap((take) => (take && !isAnalysisError(take.analysis) ? [{ take, a: take.analysis, checks: diagnose(take.analysis) }] : []))
    if (A.session !== 'free') {
      const sessionCols = toCols(slots)
      if (sessionCols.length >= 2) return sessionCols
    }
    return B ? toCols([A, B]) : null
  }, [A, B, slots])
  if (!cols) return null
  const bestId = A.session !== 'free' ? best?.take.id : undefined

  return (
    <div className="grid gap-2">
      <Typography variant="h6" component="h2">{cols.length > 2 ? "Compare this session's takes" : 'Compare takes'}</Typography>
      <div className="overflow-x-auto">
        <Table size="small" sx={{ minWidth: 420, '& td': { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } }}>
          <TableHead>
            <TableRow>
              <TableCell />
              {cols.map(({ take }) => (
                <TableCell key={take.id} align="right" title={take.name} sx={{ fontWeight: 700, verticalAlign: 'bottom', minWidth: 90 }}>
                  <span className="inline-flex flex-wrap items-center justify-end gap-1">
                    {shortName(take.name)}
                    {take.id === idA && <Chip label="A" color="primary" size="small" />}
                    {take.id === idB && <Chip label="B" color="info" size="small" />}
                    {take.id === bestId && <Chip label="best" color="success" size="small" />}
                  </span>
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {ROWS.map((row) => (
              <TableRow key={row.label}>
                <TableCell sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>{row.label}</TableCell>
                {cols.map(({ take, a, checks }) => {
                  const st = row.id ? checks.find((c) => c.id === row.id)?.status : undefined
                  return (
                    <TableCell key={take.id} align="right" sx={st ? STATUS_SX[st] : undefined}>
                      {row.value(a, checks)}
                    </TableCell>
                  )
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
