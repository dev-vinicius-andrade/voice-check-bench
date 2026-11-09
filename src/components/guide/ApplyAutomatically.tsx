import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { Code } from '../pages/PageLayout'
import { StepNote, StepText } from './StepText'

const COMMAND = 'python tools/apply-reaplugs.py reaplugs-settings.json --write'

/** Aside: write the values with tools/apply-reaplugs.py instead of typing them (Wave Link closed; ReaFIR stays manual). */
export function ApplyAutomatically({ manualReaFir }: { manualReaFir: boolean }) {
  const { t } = useTranslation()
  return (
    <Paper component="aside" aria-labelledby="guide-auto-title" variant="outlined" className="grid gap-2 p-4">
      <Typography id="guide-auto-title" variant="subtitle1" component="h2" sx={{ fontWeight: 700 }}>
        {t('guide.wl.auto.title')}
      </Typography>
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
