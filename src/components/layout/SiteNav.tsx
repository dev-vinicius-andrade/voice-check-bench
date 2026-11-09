import { useState } from 'react'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import Link from '@mui/material/Link'
import ListSubheader from '@mui/material/ListSubheader'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import useMediaQuery from '@mui/material/useMediaQuery'
import type { Theme } from '@mui/material/styles'
import MenuIcon from '@mui/icons-material/Menu'
import { useTranslation } from 'react-i18next'
import { screenToHash } from '../../hooks/useHashRoute'
import { LOCALES, LOCALE_NAMES, currentLocale } from '../../i18n'
import { useBench } from '../../store/benchStore'
import type { Screen } from '../../types'
import { chooseLocale } from './chooseLocale'
import { LanguageMenu } from './LanguageMenu'

const LINKS: readonly { screen: Screen; key: string }[] = [
  { screen: 'how', key: 'common.nav.how' },
  { screen: 'community', key: 'common.nav.community' },
  { screen: 'privacy', key: 'common.nav.privacy' },
]

/** Below 600 px the page links and the language choice collapse into a menu button. */
function NavMenu({ screen }: { screen: Screen }) {
  const { t } = useTranslation()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const close = (): void => setAnchor(null)
  const locale = currentLocale()
  return (
    <>
      <IconButton
        aria-label={t('common.nav.menu')}
        aria-controls={anchor ? 'site-nav-menu' : undefined}
        aria-haspopup="true"
        aria-expanded={anchor ? 'true' : undefined}
        onClick={(e) => setAnchor(e.currentTarget)}
        size="small"
      >
        <MenuIcon fontSize="small" />
      </IconButton>
      <Menu id="site-nav-menu" anchorEl={anchor} open={anchor !== null} onClose={close}>
        {LINKS.map((l) => (
          <MenuItem
            key={l.screen}
            component="a"
            href={screenToHash(l.screen)}
            selected={screen === l.screen}
            onClick={close}
            sx={screen === l.screen ? { color: 'primary.main' } : undefined}
          >
            {t(l.key)}
          </MenuItem>
        ))}
        <Divider />
        <ListSubheader>{t('common.language.label')}</ListSubheader>
        {LOCALES.map((l) => (
          <MenuItem
            key={l}
            lang={l}
            selected={l === locale}
            onClick={() => {
              chooseLocale(l)
              close()
            }}
          >
            {LOCALE_NAMES[l]}
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}

/** How it works · Community · Privacy (active page in the accent color), language and the Start / Continue pill. */
export function SiteNav() {
  const { t } = useTranslation()
  const compact = useMediaQuery((th: Theme) => th.breakpoints.down('sm'))
  const screen = useBench((s) => s.screen)
  const hasSessionTakes = useBench((s) => s.takes.some((tk) => tk.session === s.session))

  return (
    <nav aria-label={t('common.nav.label')} className="flex items-center gap-2 sm:gap-5">
      {compact ? (
        <NavMenu screen={screen} />
      ) : (
        <>
          {LINKS.map((l) => {
            const active = screen === l.screen
            return (
              <Link
                key={l.screen}
                href={screenToHash(l.screen)}
                underline="hover"
                variant="body2"
                color={active ? 'primary' : 'text.primary'}
                aria-current={active ? 'page' : undefined}
                sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}
              >
                {t(l.key)}
              </Link>
            )
          })}
          <LanguageMenu />
        </>
      )}
      <Button variant="contained" size="small" href={screenToHash('setup')} sx={{ whiteSpace: 'nowrap' }}>
        {hasSessionTakes ? t('common.nav.continue') : t('common.nav.start')}
      </Button>
    </nav>
  )
}
