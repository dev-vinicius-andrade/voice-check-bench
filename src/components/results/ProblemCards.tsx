// Hardware-agnostic problem cards: renders classify() output as the primary recommendation path.
// Each card shows the problem summary, ordered fix steps (plain text first), and an install offer
// when actuator commands exist but no adapter is registered. MUI + Tailwind layout only.
import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Collapse from '@mui/material/Collapse'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import type { Problem, ProblemReport } from '../../plain/classify'
import { MsgText } from '../common/MsgText'

const severityColor = (s: Problem['severity']): 'error' | 'warning' => (s === 'bad' ? 'error' : 'warning')

function ProblemCard({ p, n }: { p: Problem; n: number }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const hasActuator = p.steps.some((s) => s.actuator)
  return (
    <Paper component="li" className="grid gap-3 p-4" elevation={0} variant="outlined">
      <div className="flex items-start justify-between gap-2">
        <Typography sx={{ fontWeight: 600 }}>
          <span aria-hidden="true">{n}. </span>
          <MsgText msg={p.summary} />
        </Typography>
        <Chip size="small" color={severityColor(p.severity)} label={t(`results.problems.severity.${p.severity}`)} />
      </div>
      <ul className="m-0 grid list-none gap-2 p-0 pl-2">
        {p.steps.map((step, i) => (
          <li key={i} className="grid gap-1">
            <Typography component="span" variant="body2">
              <MsgText msg={step.text} />
            </Typography>
            {step.actuator && (
              <Typography component="span" variant="caption" color="text.secondary">
                {t('results.problems.autoAvailable')}
              </Typography>
            )}
          </li>
        ))}
      </ul>
      {hasActuator && (
        <>
          <Button size="small" variant="text" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? t('results.problems.hideAuto') : t('results.problems.showAuto')}
          </Button>
          <Collapse in={open}>
            <Alert severity="info" variant="outlined" className="mt-2">
              <Typography variant="body2">{t('results.problems.installNeeded')}</Typography>
            </Alert>
          </Collapse>
        </>
      )}
    </Paper>
  )
}

/** Classifier-based problem cards with fix steps; shown before NextActions when problems exist. */
export function ProblemCards({ report }: { report: ProblemReport }) {
  const { t } = useTranslation()
  if (!report.problems.length) return null
  return (
    <Paper component="section" aria-labelledby="problems-title" className="grid gap-3 p-4">
      <Typography id="problems-title" variant="h6" component="h2">
        {t('results.problems.title', { count: report.problems.length })}
      </Typography>
      <ol className="m-0 grid list-none gap-3 p-0">
        {report.problems.map((p, i) => (
          <ProblemCard key={p.kind} p={p} n={i + 1} />
        ))}
      </ol>
      {report.installOffer && (
        <Alert severity="info" icon={false} className="grid gap-1">
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            {t('plain.classify.installOffer.title')}
          </Typography>
          <Typography variant="body2">{t('plain.classify.installOffer.body')}</Typography>
          <Button
            size="small"
            variant="contained"
            href="https://www.reaper.fm/reaplugs/"
            target="_blank"
            rel="noopener noreferrer"
            sx={{ alignSelf: 'start', mt: 1 }}
          >
            {t('plain.classify.installOffer.button')}
          </Button>
        </Alert>
      )}
    </Paper>
  )
}