import Chip from '@mui/material/Chip'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import type { Profile } from '../../profiles/types'
import { ProfileActions } from './ProfileActions'
import { hasCapturedStates, hostLabel, micLabel, styleLabel, validationLabel } from './profileFormat'
import type { ProfilesApi } from './useProfiles'

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap gap-x-2">
      <Typography component="dt" variant="body2" color="text.secondary">{label}</Typography>
      <Typography component="dd" variant="body2" className="m-0">{value}</Typography>
    </div>
  )
}

/** One profile: name, chips (validation, active, captured), mic/style/host/distance and its actions. */
export function ProfileCard({ p, api }: { p: Profile; api: ProfilesApi }) {
  const { t } = useTranslation()
  const headingId = `profile-${p.id}-name`
  return (
    <Paper component="article" variant="outlined" aria-labelledby={headingId} className="grid gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Typography id={headingId} variant="h6" component="h2" className="min-w-0" sx={{ overflowWrap: 'anywhere' }}>
          {p.name}
        </Typography>
        {p.active && <Chip size="small" color="primary" label={t('profiles.card.active')} />}
      </div>
      <div className="flex flex-wrap gap-2">
        <Chip size="small" variant="outlined" color={p.validation ? 'success' : 'warning'} label={validationLabel(t, p)} />
        {hasCapturedStates(p) && <Chip size="small" variant="outlined" label={t('profiles.card.captured')} />}
      </div>
      <dl className="m-0 grid gap-1 sm:grid-cols-2">
        <Row label={t('profiles.card.mic')} value={micLabel(t, p)} />
        <Row label={t('profiles.card.style')} value={styleLabel(t, p)} />
        <Row label={t('profiles.card.host')} value={hostLabel(t, p)} />
        <Row label={t('profiles.card.dist')} value={p.dist} />
      </dl>
      <ProfileActions p={p} api={api} />
    </Paper>
  )
}
