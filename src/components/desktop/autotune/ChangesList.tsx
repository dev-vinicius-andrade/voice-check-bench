import Accordion from '@mui/material/Accordion'
import AccordionDetails from '@mui/material/AccordionDetails'
import AccordionSummary from '@mui/material/AccordionSummary'
import Typography from '@mui/material/Typography'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { useTranslation } from 'react-i18next'
import type { TuneChange } from '../../../desktop/tune'
import { useMsg } from '../../common/MsgText'
import { bandKey, effectValue } from './format'

/** "N changes, each with its reason": the reason, the exact change in bold and what it measurably did. */
export function ChangesList({ changes }: { changes: readonly TuneChange[] }) {
  const { t } = useTranslation()
  const tm = useMsg()
  const none = t('desktop.autotune.ui.result.metrics.note.noBursts')
  return (
    <Accordion disableGutters data-testid="autotune-changes">
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Typography variant="subtitle1" component="h3">{t('desktop.autotune.ui.result.changes', { count: changes.length })}</Typography>
      </AccordionSummary>
      <AccordionDetails>
        <ol className="m-0 grid gap-3 pl-5">
          {changes.map((c) => (
            <li key={c.id}>
              <Typography variant="body2">{tm(c.titleMsg)}</Typography>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>{tm(c.changeMsg)}</Typography>
              <Typography variant="caption" color="text.secondary">
                {t(`desktop.autotune.ui.result.effect.${c.effect.metric}`, {
                  before: effectValue(c.effect, c.effect.before, none),
                  after: effectValue(c.effect, c.effect.after, none),
                  band: t(`desktop.autotune.ui.result.bands.${bandKey(c.effect.band ?? 4)}`),
                })}
              </Typography>
            </li>
          ))}
        </ol>
      </AccordionDetails>
    </Accordion>
  )
}
