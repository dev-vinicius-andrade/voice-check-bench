import Step from '@mui/material/Step'
import StepButton from '@mui/material/StepButton'
import Stepper from '@mui/material/Stepper'
import useMediaQuery from '@mui/material/useMediaQuery'
import type { Theme } from '@mui/material/styles'
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

/** Setup · 2 cm · 8 cm · 15 cm · Processed · Results. Clicking a step navigates there. */
export function ProgressStepper() {
  const compact = useMediaQuery((t: Theme) => t.breakpoints.down('sm'))
  const screen = useBench((s) => s.screen)
  const step = useBench((s) => s.step)
  const micOn = useBench((s) => s.mic.status === 'on')
  const goTo = useBench((s) => s.goTo)
  const valid = useSlots().map((t) => !!t && !isAnalysisError(t.analysis))

  const items: Item[] = [
    { label: 'Setup', screen: 'setup', done: micOn },
    ...STEPS.map((st, i): Item => ({ label: st.dist ?? 'Processed', screen: 'step', step: i, done: valid[i] ?? false })),
    { label: 'Results', screen: 'results', done: false },
  ]
  const active =
    screen === 'setup' ? 0 : screen === 'results' ? items.length - 1 : typeof step === 'number' ? step + 1 : -1

  return (
    <nav aria-label="Progress" className="min-w-0 overflow-x-auto">
      <Stepper nonLinear activeStep={active} sx={{ minWidth: 'max-content', py: 0.5 }}>
        {items.map((it, i) => (
          <Step key={it.label} completed={it.done}>
            <StepButton
              onClick={() => goTo(it.screen, it.step)}
              aria-label={it.label}
              aria-current={i === active ? 'step' : undefined}
              sx={{ py: 0.5 }}
            >
              {compact && i !== active ? null : it.label}
            </StepButton>
          </Step>
        ))}
      </Stepper>
    </nav>
  )
}
