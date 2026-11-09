import Button from '@mui/material/Button'
import { useTranslation } from 'react-i18next'
import { STEPS } from '../../session/steps'
import { useBench } from '../../store/benchStore'
import { useCanGoNext, useFxDist } from '../../store/hooks'
import { stepDist } from './stepCopy'

/** ← Back · Skip · Next. Disabled while a take is being recorded or analyzed. */
export function StepNav() {
  const { t } = useTranslation()
  const fxDist = useFxDist()
  const step = useBench((s) => s.step)
  const busy = useBench((s) => s.recorder.phase !== 'idle')
  const canGoNext = useCanGoNext()
  const back = useBench((s) => s.back)
  const skip = useBench((s) => s.skip)
  const next = useBench((s) => s.next)

  const free = step === 'free'
  const following = typeof step === 'number' ? STEPS[step + 1] : undefined
  const nextLabel = !following
    ? t('wizard.nav.results')
    : following.cm === null
      ? t('wizard.nav.nextFx')
      : t('wizard.nav.next', { dist: stepDist(following, fxDist) })

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Button variant="text" onClick={back} disabled={busy}>
        {t('common.actions.back')}
      </Button>
      {!free && (
        <Button variant="text" onClick={skip} disabled={busy}>
          {t('common.actions.skip')}
        </Button>
      )}
      <Button variant="contained" size="large" onClick={next} disabled={busy || !canGoNext}>
        {nextLabel}
      </Button>
    </div>
  )
}
