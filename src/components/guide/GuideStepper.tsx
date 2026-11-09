import { useState, type ReactNode } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Step from '@mui/material/Step'
import StepButton from '@mui/material/StepButton'
import StepContent from '@mui/material/StepContent'
import Stepper from '@mui/material/Stepper'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'

export interface GuideStep {
  id: string
  title: string
  body: ReactNode
}

/** Vertical checklist of steps: one open at a time, "Done, next" ticks it off, any title jumps back to it. */
export function GuideStepper({ title, steps }: { title: string; steps: readonly GuideStep[] }) {
  const { t } = useTranslation()
  const [active, setActive] = useState(0)
  const [done, setDone] = useState<ReadonlySet<string>>(() => new Set())
  const allDone = steps.length > 0 && steps.every((s) => done.has(s.id))

  const next = (i: number): void => {
    setDone((d) => new Set(d).add(steps[i].id))
    setActive(i + 1)
  }
  const restart = (): void => {
    setDone(new Set())
    setActive(0)
  }

  return (
    <Paper component="section" aria-label={title} className="grid gap-3 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Typography variant="h6" component="h2">{title}</Typography>
        <Typography variant="body2" color="text.secondary" data-testid="guide-progress">
          {t('guide.nav.progress', { n: Math.min(active + 1, steps.length), total: steps.length })}
        </Typography>
      </div>
      <Stepper nonLinear activeStep={active} orientation="vertical">
        {steps.map((s, i) => (
          <Step key={s.id} completed={done.has(s.id)}>
            <StepButton onClick={() => setActive(i)}>{s.title}</StepButton>
            <StepContent>
              <div className="grid gap-3 pt-1">
                {s.body}
                <div className="flex flex-wrap gap-2">
                  <Button variant="contained" onClick={() => next(i)}>{t('guide.nav.done')}</Button>
                  {i > 0 && <Button onClick={() => setActive(i - 1)}>{t('guide.nav.back')}</Button>}
                </div>
              </div>
            </StepContent>
          </Step>
        ))}
      </Stepper>
      {allDone && (
        <Alert severity="success" action={<Button color="inherit" size="small" onClick={restart}>{t('guide.nav.restart')}</Button>}>
          {t('guide.nav.allDone')}
        </Alert>
      )}
    </Paper>
  )
}
