import Accordion from '@mui/material/Accordion'
import AccordionDetails from '@mui/material/AccordionDetails'
import AccordionSummary from '@mui/material/AccordionSummary'
import Typography from '@mui/material/Typography'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { useTranslation } from 'react-i18next'
import type { Take } from '../../types'
import { AnalysisPanel } from './AnalysisPanel'

interface TechnicalDetailsProps {
  A: Take
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called once the expand animation has finished (used to scroll to the suggested settings). */
  onEntered: () => void
}

/** "Show the technical details": every chart, table, check and the suggested settings, collapsed by default. */
export function TechnicalDetails({ A, open, onOpenChange, onEntered }: TechnicalDetailsProps) {
  const { t } = useTranslation()
  return (
    <Accordion
      expanded={open}
      onChange={(_e, v) => onOpenChange(v)}
      disableGutters
      slotProps={{ transition: { unmountOnExit: true, onEntered } }}
      sx={{ '&::before': { display: 'none' } }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />} aria-controls="technical-details" id="technical-details-summary">
        <Typography component="h2" sx={{ fontWeight: 700 }}>{t('results.details.title')}</Typography>
      </AccordionSummary>
      <AccordionDetails id="technical-details" className="grid min-w-0 gap-4">
        <AnalysisPanel A={A} />
      </AccordionDetails>
    </Accordion>
  )
}
