import Button, { type ButtonProps } from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { useBench } from '../../store/benchStore'

/** Secondary "Tune live" button: opens #/live. */
export function TuneLiveButton({ size = 'small' }: Pick<ButtonProps, 'size'>) {
  const { t } = useTranslation()
  const goTo = useBench((s) => s.goTo)
  return (
    <Button size={size} variant="outlined" onClick={() => goTo('live')} data-testid="tune-live">
      {t('live.entry.button')}
    </Button>
  )
}

/** End of the guide: a short line and the "Tune live" button. */
export function GuideLiveCta() {
  const { t } = useTranslation()
  return (
    <Paper variant="outlined" className="flex flex-wrap items-center justify-between gap-3 p-4">
      <Typography variant="body2" color="text.secondary" sx={{ flex: '1 1 16rem' }}>{t('live.entry.guideText')}</Typography>
      <TuneLiveButton size="medium" />
    </Paper>
  )
}
