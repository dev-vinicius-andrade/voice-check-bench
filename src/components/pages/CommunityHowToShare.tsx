import Link from '@mui/material/Link'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { COMMUNITY_LABEL } from '../../community/types'
import { SITE } from '../../site'
import { SHARE_STEPS } from './howItWorksData'


/** "How to share" box with the link to all shared results on GitHub. */
export function CommunityHowToShare() {
  const { t } = useTranslation()
  return (
    <Paper className="grid gap-3 p-5">
      <Typography variant="h6" component="h2" sx={{ textTransform: 'uppercase' }}>
        {t('pages.community.share.title')}
      </Typography>
      <Typography component="ol" color="text.secondary" sx={{ m: 0, pl: 3, display: 'grid', gap: 0.5 }}>
        {SHARE_STEPS.map((id) => (
          <li key={id}>{t(`pages.community.share.${id}`)}</li>
        ))}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {t('pages.community.share.note')}{' '}
        <Link href={`${SITE.repo}/issues?q=label%3A${COMMUNITY_LABEL}`} target="_blank" rel="noopener noreferrer">
          {t('pages.community.share.all')}
        </Link>
      </Typography>
    </Paper>
  )
}
