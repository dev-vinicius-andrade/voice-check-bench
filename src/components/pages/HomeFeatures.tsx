import NoiseControlOffIcon from '@mui/icons-material/NoiseControlOff'
import GroupsIcon from '@mui/icons-material/Groups'
import LockIcon from '@mui/icons-material/Lock'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'

/** pages.home.features.<id>.title / .text */
const FEATURES = [
  { id: 'rooms', icon: NoiseControlOffIcon },
  { id: 'owners', icon: GroupsIcon },
  { id: 'private', icon: LockIcon },
] as const

/** Three feature cards with icons (3 → 1 columns). */
export function HomeFeatures() {
  const { t } = useTranslation()
  return (
    <section aria-label={t('pages.home.featuresLabel')} className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {FEATURES.map(({ id, icon: Icon }) => (
        <Paper key={id} className="grid content-start gap-2 p-5">
          <Icon color="primary" fontSize="large" aria-hidden />
          <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 700 }}>
            {t(`pages.home.features.${id}.title`)}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t(`pages.home.features.${id}.text`)}
          </Typography>
        </Paper>
      ))}
    </section>
  )
}
