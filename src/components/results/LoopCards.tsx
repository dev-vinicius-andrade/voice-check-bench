// The other outcomes of an evaluated attempt: wrong distance, change of approach, and "it worked".
import Alert from '@mui/material/Alert'
import AlertTitle from '@mui/material/AlertTitle'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { fmtNum } from '../../i18n/format'
import { changeApproachAdvice } from '../../plain/refine'
import { useBench } from '../../store/benchStore'
import type { Take } from '../../types'
import { MsgText } from '../common/MsgText'
import { useGuideOverride } from '../guide/guideOverride'
import { SaveProfile } from '../profiles/SaveProfile'
import { distLabel, RecordAgainButton } from './RecordAgainButton'

/**
 * The take was recorded at another distance than the settings were made for: no refinement. Either record again at
 * the settings' distance, or make new settings for the recorded distance (the guide builds them from the raw take there).
 */
export function MismatchCard({ recorded, dist }: { recorded: string; dist: string }) {
  const { t } = useTranslation()
  const d = distLabel(dist)
  const r = distLabel(recorded)
  const makeNew = (): void => {
    useGuideOverride.getState().clear()
    const st = useBench.getState()
    st.setFxDist(recorded)
    st.goTo('guide')
  }
  return (
    <Alert severity="warning" data-testid="mismatch-card">
      <AlertTitle>{t('results.mismatch.title')}</AlertTitle>
      <div className="grid justify-items-start gap-2">
        <span>{t('results.mismatch.text', { recorded: r, dist: d })}</span>
        <div className="flex flex-wrap gap-2">
          <RecordAgainButton dist={dist} label={t('results.mismatch.button', { dist: d })} />
          <Button size="small" variant="outlined" onClick={makeNew}>{t('results.mismatch.makeNew', { recorded: r })}</Button>
        </div>
      </div>
    </Alert>
  )
}

/** After 3 attempts without improvement: AI noise removal + physical actions instead of more tweaks. */
export function ChangeApproachCard({ attempts, dist }: { attempts: number; dist: string }) {
  const { t } = useTranslation()
  const goTo = useBench((s) => s.goTo)
  return (
    <Paper component="section" aria-labelledby="approach-title" className="grid gap-3 p-4" data-testid="approach-card" sx={{ borderColor: 'warning.main' }}>
      <Typography id="approach-title" variant="h6" component="h2">{t('results.approach.title')}</Typography>
      <Typography variant="body2" color="text.secondary">{t('results.approach.lead', { n: attempts })}</Typography>
      <ul className="m-0 grid gap-1 pl-5">
        {changeApproachAdvice().map((m) => (
          <Typography component="li" variant="body2" key={m.key}>
            <MsgText msg={m} />
          </Typography>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button size="small" variant="contained" onClick={() => goTo('guide')}>{t('results.approach.guide')}</Button>
        <RecordAgainButton dist={dist} />
      </div>
    </Paper>
  )
}

/** The applied settings made the voice better: say so and offer to keep them as a profile. */
export function WorkedCard({ A, raw, fx }: { A: Take; raw: number; fx: number }) {
  const { t } = useTranslation()
  return (
    <Paper component="section" aria-labelledby="worked-title" className="grid gap-3 p-4" data-testid="worked-card" sx={{ borderColor: 'success.main' }}>
      <Typography id="worked-title" variant="h6" component="h2" color="success.main">{t('results.worked.title')}</Typography>
      <Typography variant="body2">{t('results.worked.text', { raw: fmtNum(raw, 0), fx: fmtNum(fx, 0) })}</Typography>
      <SaveProfile A={A} />
    </Paper>
  )
}
