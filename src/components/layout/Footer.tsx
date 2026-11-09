import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Link from '@mui/material/Link'
import SvgIcon, { type SvgIconProps } from '@mui/material/SvgIcon'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import GitHubIcon from '@mui/icons-material/GitHub'
import LinkedInIcon from '@mui/icons-material/LinkedIn'
import MailOutlinedIcon from '@mui/icons-material/MailOutlined'
import { useTranslation } from 'react-i18next'
import { SITE } from '../../site'

const external = { target: '_blank', rel: 'noopener noreferrer' } as const

/** Stack Overflow logo (Simple Icons, CC0). MUI has no brand icon for it. */
function StackOverflowIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props} viewBox="0 0 24 24">
      <path d="M15.725 0l-1.72 1.277 6.39 8.588 1.716-1.277L15.725 0zm-3.94 3.418l-1.369 1.644 8.225 6.85 1.369-1.644-8.225-6.85zm-3.15 4.465l-.905 1.94 9.702 4.517.904-1.94-9.701-4.517zm-1.85 4.86l-.44 2.093 10.473 2.201.44-2.092-10.473-2.203zM1.89 15.47V24h19.19v-8.53h-2.133v6.397H4.021v-6.396H1.89zm4.265 2.133v2.13h10.66v-2.13H6.154z" />
    </SvgIcon>
  )
}

const LINKS = [
  { label: 'GitHub', href: SITE.author.github, Icon: GitHubIcon, ext: true },
  { label: 'LinkedIn', href: SITE.author.linkedin, Icon: LinkedInIcon, ext: true },
  { label: 'Stack Overflow', href: SITE.author.stackoverflow, Icon: StackOverflowIcon, ext: true },
  { label: 'common.footer.email', href: `mailto:${SITE.author.email}`, Icon: MailOutlinedIcon, ext: false },
] as const

/** Footer on every screen: author + social icons on the left, project links on the right; stacks on mobile. */
export function Footer() {
  const { t } = useTranslation()
  // Brand names stay literal; only the email entry is a message key.
  const text = (label: string): string => (label.startsWith('common.') ? t(label, { email: SITE.author.email }) : label)
  return (
    <Box component="footer" sx={{ borderTop: 1, borderColor: 'divider', color: 'text.secondary', mt: 6 }}>
      <div className="mx-auto flex max-w-[1240px] flex-col items-center gap-3 px-4 py-6 sm:flex-row sm:justify-between">
        <div className="flex flex-col items-center gap-1 sm:flex-row sm:gap-4">
          <Typography variant="body2">
            {t('common.footer.madeBy')}{' '}
            <Link href={SITE.author.site} {...external} color="primary" underline="hover" sx={{ fontWeight: 600 }}>
              {SITE.author.name}
            </Link>
          </Typography>
          <nav aria-label={t('common.footer.authorLinks')} className="flex items-center gap-1">
            {LINKS.map(({ label, href, Icon, ext }) => (
              <Tooltip key={label} title={text(label)}>
                <IconButton
                  href={href}
                  {...(ext ? external : {})}
                  aria-label={text(label)}
                  size="small"
                  sx={{ color: 'text.secondary', '&:hover': { color: 'primary.main' } }}
                >
                  <Icon fontSize="small" />
                </IconButton>
              </Tooltip>
            ))}
          </nav>
        </div>
        <Typography variant="body2" component="div" className="flex items-center gap-2">
          <Link href={SITE.repo} {...external} color="inherit" underline="hover">
            {t('common.footer.source')}
          </Link>
          <span aria-hidden="true">·</span>
          <Link href={SITE.issues} {...external} color="inherit" underline="hover">
            {t('common.footer.issue')}
          </Link>
        </Typography>
      </div>
    </Box>
  )
}
