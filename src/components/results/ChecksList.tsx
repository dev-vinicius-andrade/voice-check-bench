import Accordion from '@mui/material/Accordion'
import AccordionDetails from '@mui/material/AccordionDetails'
import AccordionSummary from '@mui/material/AccordionSummary'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { useTranslation } from 'react-i18next'
import type { Check, Status } from '../../types'
import { useMsg } from '../common/MsgText'

const PILL: Record<Status, 'success' | 'warning' | 'error'> = { good: 'success', warn: 'warning', bad: 'error' }

function CheckRow({ c }: { c: Check }) {
  const { t } = useTranslation()
  const tm = useMsg()
  return (
    <Paper className="grid grid-cols-[58px_minmax(0,1fr)] items-start gap-2.5 px-2.5 py-2">
      <Chip label={t(`results.checks.${c.status}`)} color={PILL[c.status]} size="small" />
      <div className="min-w-0">
        <div>
          <Typography component="span" sx={{ fontWeight: 700 }}>{tm(c.titleMsg)}</Typography>
          {c.valueMsg && <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.75 }}>{tm(c.valueMsg)}</Typography>}
        </div>
        <Typography variant="body2" color="text.secondary">{tm(c.detailMsg)}</Typography>
        {c.fixMsg && (
          <Typography variant="body2" sx={{ mt: 0.25 }}>
            <Box component="span" sx={{ color: 'primary.main', fontWeight: 700 }}>{t('results.checks.try')} </Box>
            {tm(c.fixMsg)}
          </Typography>
        )}
      </div>
    </Paper>
  )
}

const ORDER: Record<Status, number> = { bad: 0, warn: 1, good: 2 }

/** Problems for A (bad, then warn), passing checks collapsed (prototype renderResults). */
export function ChecksList({ checks }: { checks: readonly Check[] }) {
  const { t } = useTranslation()
  const issues = checks.filter((c) => c.status !== 'good').sort((x, y) => ORDER[x.status] - ORDER[y.status])
  const pass = checks.filter((c) => c.status === 'good')
  return (
    <div className="grid gap-2">
      <Typography variant="h6" component="h2">{t('results.checks.title')}</Typography>
      {issues.length ? (
        issues.map((c) => <CheckRow key={c.id} c={c} />)
      ) : (
        <Typography variant="body2" color="text.secondary">{t('results.checks.none')}</Typography>
      )}
      {pass.length > 0 && (
        <Accordion disableGutters sx={{ '&::before': { display: 'none' } }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{t('results.checks.passing', { count: pass.length })}</Typography>
          </AccordionSummary>
          <AccordionDetails className="grid gap-2">
            {pass.map((c) => <CheckRow key={c.id} c={c} />)}
          </AccordionDetails>
        </Accordion>
      )}
    </div>
  )
}
