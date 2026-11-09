import Accordion from '@mui/material/Accordion'
import AccordionDetails from '@mui/material/AccordionDetails'
import AccordionSummary from '@mui/material/AccordionSummary'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import type { Check, Status } from '../../types'

const PILL: Record<Status, { label: string; color: 'success' | 'warning' | 'error' }> = {
  good: { label: 'ok', color: 'success' },
  warn: { label: 'warn', color: 'warning' },
  bad: { label: 'bad', color: 'error' },
}

function CheckRow({ c }: { c: Check }) {
  const pill = PILL[c.status]
  return (
    <Paper className="grid grid-cols-[58px_minmax(0,1fr)] items-start gap-2.5 px-2.5 py-2">
      <Chip label={pill.label} color={pill.color} size="small" />
      <div className="min-w-0">
        <div>
          <Typography component="span" sx={{ fontWeight: 700 }}>{c.title}</Typography>
          <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.75 }}>{c.value}</Typography>
        </div>
        <Typography variant="body2" color="text.secondary">{c.detail}</Typography>
        {c.fix && (
          <Typography variant="body2" sx={{ mt: 0.25 }}>
            <Box component="span" sx={{ color: 'primary.main', fontWeight: 700 }}>Try: </Box>
            {c.fix}
          </Typography>
        )}
      </div>
    </Paper>
  )
}

const ORDER: Record<Status, number> = { bad: 0, warn: 1, good: 2 }

/** Problems for A (bad, then warn), passing checks collapsed (prototype renderResults). */
export function ChecksList({ checks }: { checks: readonly Check[] }) {
  const issues = checks.filter((c) => c.status !== 'good').sort((x, y) => ORDER[x.status] - ORDER[y.status])
  const pass = checks.filter((c) => c.status === 'good')
  return (
    <div className="grid gap-2">
      <Typography variant="h6" component="h2">Checks for A</Typography>
      {issues.length ? (
        issues.map((c) => <CheckRow key={c.id} c={c} />)
      ) : (
        <Typography variant="body2" color="text.secondary">No problems found.</Typography>
      )}
      {pass.length > 0 && (
        <Accordion disableGutters sx={{ '&::before': { display: 'none' } }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{pass.length} checks passing</Typography>
          </AccordionSummary>
          <AccordionDetails className="grid gap-2">
            {pass.map((c) => <CheckRow key={c.id} c={c} />)}
          </AccordionDetails>
        </Accordion>
      )}
    </div>
  )
}
