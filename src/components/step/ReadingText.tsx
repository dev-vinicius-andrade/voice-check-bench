import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { useBench } from '../../store/benchStore'

/** Large reading passage for the active locale (wizard.reading.passage), dimmed until the reading phase starts. */
export function ReadingText() {
  const { t, i18n } = useTranslation()
  const live = useBench((s) => s.recorder.phase === 'reading')
  return (
    <div className="grid gap-2">
      <Typography variant="body2" color="text.secondary" sx={{ m: 0 }}>
        {t('wizard.reading.note')}
      </Typography>
      <Typography
        lang={i18n.language}
        sx={{
          fontSize: { xs: 20, sm: 24 },
          lineHeight: 1.65,
          m: 0,
          color: live ? 'text.primary' : 'text.secondary',
          opacity: live ? 1 : 0.75,
          transition: 'color .25s, opacity .25s',
        }}
      >
        {t('wizard.reading.passage')}
      </Typography>
    </div>
  )
}
