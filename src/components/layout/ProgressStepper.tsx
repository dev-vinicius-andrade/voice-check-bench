import Step from '@mui/material/Step'
import StepButton from '@mui/material/StepButton'
import Stepper from '@mui/material/Stepper'
import useMediaQuery from '@mui/material/useMediaQuery'
import type { Theme } from '@mui/material/styles'
import { useTranslation } from 'react-i18next'
import { fmtNum } from '../../i18n/format'
import { STEPS } from '../../session/steps'
import { useBench } from '../../store/benchStore'
import { useSlots } from '../../store/hooks'
import { isAnalysisError } from '../../types'
import type { Screen, StepRef } from '../../types'

interface Item {
  label: string
  screen: Screen
  step?: StepRef
  done: boolean
}

/** Setup · 2 cm · 8 cm · 15 cm · Effects · Results. Clicking a step navigates there. */
export function ProgressStepper() {
  const compact = useMediaQuery((th: Theme) => th.breakpoints.down('sm'))
  const screen = useBench((s) => s.screen)
  const step = useBench((s) => s.step)
  const micOn = useBench((s) => s.mic.status === 'on')
  const goTo = useBench((s) => s.goTo)
  const valid = useSlots().map((t) => !!t && !isAnalysisError(t.analysis))

  const { t } = useTranslation()
  const stepLabel = (cm: number | null): string =>
    cm === null ? t('wizard.stepper.fx') : t('common.units.cm', { value: fmtNum(cm, 0) })
  const items: Item[] = [
    { label: t('wizard.stepper.setup'), screen: 'setup', done: micOn },
    ...STEPS.map((st, i): Item => ({ label: stepLabel(st.cm), screen: 'step', step: i, done: valid[i] ?? false })),
    { label: t('wizard.stepper.results'), screen: 'results', done: false },
  ]
  const active =
    screen === 'setup' ? 0 : screen === 'results' ? items.length - 1 : typeof step === 'number' ? step + 1 : -1

  return (
    <nav aria-label={t('common.nav.progress')} className="min-w-0 overflow-x-auto overflow-y-hidden [scrollbar-width:none]">
      <Stepper nonLinear activeStep={active} sx={{ minWidth: 'max-content', py: 0.5, '& .MuiStepConnector-root': { minWidth: 12 } }}>
        {items.map((it, i) => (
          <Step key={it.label} completed={it.done} sx={{ px: 0.5 }}>
            <StepButton
              onClick={() => goTo(it.screen, it.step)}
              aria-label={it.label}
              aria-current={i === active ? 'step' : undefined}
              sx={{ py: 0.5, px: 1, m: 0 }}
            >
              {compact && i !== active ? null : it.label}
            </StepButton>
          </Step>
        ))}
      </Stepper>
    </nav>
  )
}
