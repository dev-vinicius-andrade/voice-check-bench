import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Link from '@mui/material/Link'
import Typography from '@mui/material/Typography'
import CodeIcon from '@mui/icons-material/Code'
import GitHubIcon from '@mui/icons-material/GitHub'
import LinkedInIcon from '@mui/icons-material/LinkedIn'
import MailOutlinedIcon from '@mui/icons-material/MailOutlined'
import { SITE } from '../../site'

const external = { target: '_blank', rel: 'noopener noreferrer' } as const
const mailto = `mailto:${SITE.author.email}`

const ICONS = [
  { label: 'GitHub', href: SITE.author.github, Icon: GitHubIcon },
  { label: 'LinkedIn', href: SITE.author.linkedin, Icon: LinkedInIcon },
  { label: 'Stack Overflow', href: SITE.author.stackoverflow, Icon: CodeIcon },
] as const

/** Author and project links on every screen: thin top divider, muted mono text, stacked on mobile. */
export function Footer() {
  return (
    <Box component="footer" sx={{ borderTop: 1, borderColor: 'divider', color: 'text.secondary' }}>
      <div className="mx-auto flex max-w-[1240px] flex-col gap-3 px-4 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Link href={SITE.author.site} {...external} variant="body2" color="inherit" underline="hover">
            Made by {SITE.author.name}
          </Link>
          <div className="flex items-center">
            {ICONS.map(({ label, href, Icon }) => (
              <IconButton key={label} href={href} {...external} aria-label={label} title={label} size="small" color="inherit">
                <Icon fontSize="small" />
              </IconButton>
            ))}
            <IconButton href={mailto} aria-label="Email" title="Email" size="small" color="inherit">
              <MailOutlinedIcon fontSize="small" />
            </IconButton>
          </div>
          <Link href={mailto} variant="body2" color="inherit" underline="hover">
            {SITE.author.email}
          </Link>
        </div>
        <Typography variant="body2" component="div" className="flex flex-wrap items-center gap-x-2">
          <Link href={SITE.repo} {...external} color="inherit" underline="hover">
            Source on GitHub
          </Link>
          <span aria-hidden="true">·</span>
          <Link href={SITE.issues} {...external} color="inherit" underline="hover">
            Report an issue
          </Link>
        </Typography>
      </div>
    </Box>
  )
}
