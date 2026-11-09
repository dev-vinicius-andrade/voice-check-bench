import { useMemo } from 'react'
import Chip from '@mui/material/Chip'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { countByStatus, diagnose } from '../../audio/diagnose'
import { fmtNum, fmtSigned } from '../../i18n/format'
import { BANDS, deviations } from '../../audio/reference'
import { isAnalysisError, type Analysis, type Check, type CheckId, type Status, type Take } from '../../types'
import { useBench } from '../../store/benchStore'
import { useTakeName } from './useTakeName'
import { useBestControl, useSlots } from '../../store/hooks'

interface Row {
  key: string
  label: (t: TFunction) => string
  id: CheckId | null
  value: (a: Analysis, checks: Check[]) => string
}

const BAND_IDS: CheckId[] = ['boom', 'warmth', 'mud', 'body', 'definition', 'presence', 'sibilance', 'air']

const ROWS: Row[] = [
  { key: 'speech', label: (t) => t('results.compare.speech'), id: 'level', value: (a) => fmtNum(a.speechMed, 1) },
  { key: 'noise', label: (t) => t('results.compare.noise'), id: 'noise', value: (a) => fmtNum(a.noise, 0) },
  { key: 'snr', label: (t) => t('results.compare.snr'), id: 'noise', value: (a) => fmtNum(a.snr, 0) },
  ...BAND_IDS.map((id, k): Row => ({
    key: id,
    label: (t) => `${t(`results.band.${k + 1}`)} ${BANDS[k + 1].name}`,
    id,
    value: (a) => fmtSigned(deviations(a.rel)[k + 1], 1),
  })),
  { key: 'consistency', label: (t) => t('results.compare.consistency'), id: 'consistency', value: (a) => fmtNum(a.spread, 1) },
  { key: 'problems', label: (t) => t('results.compare.problems'), id: null, value: (_a, c) => { const n = countByStatus(c); return `${n.bad} · ${n.warn}` } },
]

const STATUS_SX: Record<Status, object> = {
  good: { color: 'success.main' },
  warn: { color: 'warning.main' },
  bad: { color: 'error.main', fontWeight: 700 },
}

interface Col { take: Take; a: Analysis; checks: Check[] }

/** Session takes (or A and B) side by side, cells coloured by the matching check (prototype renderCompare). */
export function CompareTable({ A, B }: { A: Take; B: Take | null }) {
  const { t } = useTranslation()
  const tn = useTakeName()
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
      <Typography variant="h6" component="h2">{cols.length > 2 ? t('results.compare.titleSession') : t('results.compare.title')}</Typography>
      <div className="overflow-x-auto">
        <Table size="small" sx={{ minWidth: 420, '& td': { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } }}>
          <TableHead>
            <TableRow>
              <TableCell />
              {cols.map(({ take }) => (
                <TableCell key={take.id} align="right" title={tn(take)} sx={{ fontWeight: 700, verticalAlign: 'bottom', minWidth: 90 }}>
                  <span className="inline-flex flex-wrap items-center justify-end gap-1">
                    {tn(take)}
                    {take.id === idA && <Chip label="A" color="primary" size="small" />}
                    {take.id === idB && <Chip label="B" color="info" size="small" />}
                    {take.id === bestId && <Chip label={t('results.compare.best')} color="success" size="small" />}
                  </span>
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {ROWS.map((row) => (
              <TableRow key={row.key}>
                <TableCell sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>{row.label(t)}</TableCell>
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
