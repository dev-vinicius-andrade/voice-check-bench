import Button from '@mui/material/Button'
import { STEPS } from '../../session/steps'
import { useBench } from '../../store/benchStore'
import { useCanGoNext } from '../../store/hooks'

/** ← Back · Skip · Next. Disabled while a take is being recorded or analyzed. */
export function StepNav() {
  const step = useBench((s) => s.step)
  const busy = useBench((s) => s.recorder.phase !== 'idle')
  const canGoNext = useCanGoNext()
  const back = useBench((s) => s.back)
  const skip = useBench((s) => s.skip)
  const next = useBench((s) => s.next)

  const free = step === 'free'
  const following = typeof step === 'number' ? STEPS[step + 1] : undefined
  const nextLabel = following ? `Next: ${following.dist ?? 'processed'} →` : 'See results →'

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Button variant="text" onClick={back} disabled={busy}>
        ← Back
      </Button>
      {!free && (
        <Button variant="text" onClick={skip} disabled={busy}>
          Skip
        </Button>
      )}
      <Button variant="contained" size="large" onClick={next} disabled={busy || !canGoNext}>
        {nextLabel}
      </Button>
    </div>
  )
}
