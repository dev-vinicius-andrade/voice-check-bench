import Link from '@mui/material/Link'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { COMMUNITY_LABEL } from '../../community/types'
import { SITE } from '../../site'

const STEPS = [
  'Finish a check.',
  'Open Results.',
  'Click "Share with the community".',
  'Review the summary on GitHub.',
  'Submit the issue.',
] as const

/** "How to share" box with the link to all shared results on GitHub. */
export function CommunityHowToShare() {
  return (
    <Paper className="grid gap-3 p-5">
      <Typography variant="h6" component="h2" sx={{ textTransform: 'uppercase' }}>
        How to share
      </Typography>
      <Typography component="ol" color="text.secondary" sx={{ m: 0, pl: 3, display: 'grid', gap: 0.5 }}>
        {STEPS.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        You need a GitHub account. The issue is public and has no audio.{' '}
        <Link href={`${SITE.repo}/issues?q=label%3A${COMMUNITY_LABEL}`} target="_blank" rel="noopener noreferrer">
          See all shared results on GitHub
        </Link>
      </Typography>
    </Paper>
  )
}
