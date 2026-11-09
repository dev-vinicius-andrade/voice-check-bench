import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { useSuggestion } from '../../store/hooks'
import { Code } from '../pages/PageLayout'
import { ApplyToWaveLinkButton } from '../wavelink/ApplyToWaveLinkButton'
import { StepNote, StepText } from './StepText'

const COMMAND = 'python tools/apply-reaplugs.py reaplugs-settings.json --write'

/**
 * Aside: apply the values to Wave Link's settings file from the browser (upload → preview → download), with
 * tools/apply-reaplugs.py kept as the terminal alternative (Wave Link closed; ReaFIR stays manual).
 */
export function ApplyAutomatically({ manualReaFir }: { manualReaFir: boolean }) {
  const { t } = useTranslation()
  const s = useSuggestion()
  return (
    <Paper component="aside" aria-labelledby="guide-auto-title" variant="outlined" className="grid gap-3 p-4">
      <Typography id="guide-auto-title" variant="subtitle1" component="h2" sx={{ fontWeight: 700 }}>
        {t('guide.wl.auto.title')}
      </Typography>
      <Typography variant="body2">{t('profiles.wl.guideLead')}</Typography>
      {s && (
        <div>
          <ApplyToWaveLinkButton s={s} />
        </div>
      )}
      {manualReaFir && <StepNote>{t('profiles.wl.reafirNote')}</StepNote>}
      <Typography variant="subtitle2" component="h3">{t('profiles.wl.pythonTitle')}</Typography>
      <StepText
        lead={t('guide.wl.auto.text')}
        actions={[{ text: t('guide.wl.auto.a1') }, { text: t('guide.wl.auto.a2') }, { text: t('guide.wl.auto.a3') }]}
        notes={
          <>
            <div><Code>{COMMAND}</Code></div>
            <StepNote>{t('guide.wl.auto.a4')}</StepNote>
            {manualReaFir && <StepNote>{t('guide.wl.auto.a5')}</StepNote>}
          </>
        }
      />
    </Paper>
  )
}
