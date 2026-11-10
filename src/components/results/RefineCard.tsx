import { useCallback, useState } from 'react'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { useBench } from '../../store/benchStore'
import type { AppliedSettings, Refinement } from '../../types'
import type { WlApplyPlan, WlFile } from '../../wavelink/types'
import { MsgText } from '../common/MsgText'
import { useGuideOverride } from '../guide/guideOverride'
import { WaveLinkApplyDialog } from '../wavelink/WaveLinkApplyDialog'
import { refinedPlan } from '../wavelink/wlPlan'
import { TuneLiveButton } from '../live/TuneLiveButton'
import { distLabel, RecordAgainButton } from './RecordAgainButton'

/** "Let's fix this": what changes for the next attempt, applied to Wave Link, by hand (guide) or straight to recording. */
export function RefineCard({ refinement: r, applied }: { refinement: Refinement; applied: AppliedSettings }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const next = applied.attempt + 1
  const buildPlan = useCallback((_file: WlFile, key: string) => refinedPlan(r, key), [r])
  const onApplied = (plan: WlApplyPlan): void =>
    useBench.getState().markApplied({ settings: plan.suggestion ?? r.settings, noiseRemoval: r.noiseRemoval, dist: r.dist, attempt: next })
  const byHand = (): void => {
    useGuideOverride.getState().set(r, next)
    const st = useBench.getState()
    st.setFxDist(r.dist)
    st.goTo('guide')
  }
  const routeChanged = r.noiseRemoval !== applied.noiseRemoval
  return (
    <Paper component="section" aria-labelledby="refine-title" className="grid gap-3 p-4" data-testid="refine-card" sx={{ borderColor: 'warning.main' }}>
      <Typography id="refine-title" variant="h6" component="h2">{t('results.refine.title')}</Typography>
      <Typography variant="body2" color="text.secondary">{t('results.refine.lead')}</Typography>
      <ul className="m-0 grid gap-1 pl-5" aria-label={t('results.refine.changes')}>
        {r.changes.map((c, i) => (
          <Typography component="li" variant="body2" key={`${c.reason}-${i}`}>
            <MsgText msg={c.msg} />
          </Typography>
        ))}
        {routeChanged && (
          <Typography component="li" variant="body2" data-testid="refine-route">{t(`results.refine.route.${r.noiseRemoval}`)}</Typography>
        )}
      </ul>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>{t('results.refine.nextDist', { dist: distLabel(r.dist) })}</Typography>
      <div className="flex flex-wrap gap-2">
        <Button size="small" variant="contained" onClick={() => setOpen(true)}>{t('results.refine.apply')}</Button>
        <Button size="small" variant="outlined" onClick={byHand}>{t('results.refine.byHand')}</Button>
        <RecordAgainButton dist={r.dist} />
        <TuneLiveButton />
      </div>
      <WaveLinkApplyDialog open={open} onClose={() => setOpen(false)} buildPlan={buildPlan} onApplied={onApplied} title={t('results.refine.dialogTitle')} />
    </Paper>
  )
}
