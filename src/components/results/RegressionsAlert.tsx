import Alert from '@mui/material/Alert'
import AlertTitle from '@mui/material/AlertTitle'
import { useTranslation } from 'react-i18next'
import { fmtNum } from '../../i18n/format'
import type { ProcessedComparison } from '../../plain/compare'

/** What the effects made worse than the raw take, in plain words (v0.8). Renders nothing without regressions. */
export function RegressionsAlert({ cmp }: { cmp: ProcessedComparison }) {
  const { t } = useTranslation()
  if (!cmp.regressions.length) return null
  return (
    <Alert severity="warning" data-testid="regressions-alert">
      <AlertTitle>{t('results.regressions.title')}</AlertTitle>
      <ul className="m-0 grid gap-0.5 pl-5">
        {cmp.regressions.map((r) => (
          <li key={r}>{t(`results.regressions.${r}`, { db: fmtNum(cmp.levelDrop, 0) })}</li>
        ))}
      </ul>
    </Alert>
  )
}
