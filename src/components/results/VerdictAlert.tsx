import Alert from '@mui/material/Alert'
import AlertTitle from '@mui/material/AlertTitle'
import { countByStatus, topIssues } from '../../audio/diagnose'
import type { Analysis, Check } from '../../types'

/** "Fix first: …" verdict for take A, coloured by its worst check (prototype renderResults). */
export function VerdictAlert({ analysis, checks }: { analysis: Analysis; checks: readonly Check[] }) {
  const { bad, warn } = countByStatus(checks)
  const top = topIssues(checks)
  const severity = bad ? 'error' : warn ? 'warning' : 'success'
  const title = top.length
    ? 'Fix first: ' + top.map((c) => c.title.replace(/\s*\(.*\)/, '')).join(' · ')
    : 'Balanced. Nothing stands out.'
  const note =
    (analysis.quietBroken ? 'Noise reading may be off: there was sound in the first 3 s. ' : '') +
    (top[0]?.fix ? 'Start with: ' + top[0].fix : '')
  return (
    <Alert severity={severity}>
      <AlertTitle sx={{ fontWeight: 700, mb: note ? 0.5 : 0 }}>{title}</AlertTitle>
      {note}
    </Alert>
  )
}
