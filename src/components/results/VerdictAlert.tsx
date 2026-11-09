import Alert from '@mui/material/Alert'
import AlertTitle from '@mui/material/AlertTitle'
import { useTranslation } from 'react-i18next'
import { countByStatus, topIssues } from '../../audio/diagnose'
import type { Analysis, Check } from '../../types'
import { useMsg } from '../common/MsgText'

/** "Fix first: …" verdict for take A, coloured by its worst check (prototype renderResults). */
export function VerdictAlert({ analysis, checks }: { analysis: Analysis; checks: readonly Check[] }) {
  const { t } = useTranslation()
  const tm = useMsg()
  const { bad, warn } = countByStatus(checks)
  const top = topIssues(checks)
  const severity = bad ? 'error' : warn ? 'warning' : 'success'
  const title = top.length
    ? t('results.verdict.fixFirst', { list: top.map((c) => tm(c.titleMsg).replace(/\s*\(.*\)/, '')).join(' · ') })
    : t('results.verdict.balanced')
  const note = [
    analysis.quietBroken ? t('results.verdict.quietBroken') : '',
    top[0]?.fixMsg ? t('results.verdict.startWith', { fix: tm(top[0].fixMsg) }) : '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <Alert severity={severity}>
      <AlertTitle sx={{ fontWeight: 700, mb: note ? 0.5 : 0 }}>{title}</AlertTitle>
      {note}
    </Alert>
  )
}
