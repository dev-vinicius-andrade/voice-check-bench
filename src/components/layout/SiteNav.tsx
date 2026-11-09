import { useState } from 'react'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Link from '@mui/material/Link'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import useMediaQuery from '@mui/material/useMediaQuery'
import type { Theme } from '@mui/material/styles'
import MenuIcon from '@mui/icons-material/Menu'
import { screenToHash } from '../../hooks/useHashRoute'
import { useBench } from '../../store/benchStore'
import type { Screen } from '../../types'

const LINKS: readonly { screen: Screen; label: string }[] = [
  { screen: 'how', label: 'How it works' },
  { screen: 'community', label: 'Community' },
  { screen: 'privacy', label: 'Privacy' },
]

/** Below 600 px the page links collapse into a menu button. */
function NavMenu({ screen }: { screen: Screen }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const close = (): void => setAnchor(null)
  return (
    <>
      <IconButton
        aria-label="Site pages"
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
            {l.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}

/** How it works · Community · Privacy (active page in the accent color) and the Start / Continue pill. */
export function SiteNav() {
  const compact = useMediaQuery((t: Theme) => t.breakpoints.down('sm'))
  const screen = useBench((s) => s.screen)
  const hasSessionTakes = useBench((s) => s.takes.some((t) => t.session === s.session))

  return (
    <nav aria-label="Site" className="flex items-center gap-2 sm:gap-5">
      {compact ? (
        <NavMenu screen={screen} />
      ) : (
        LINKS.map((l) => {
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
              {l.label}
            </Link>
          )
        })
      )}
      <Button variant="contained" size="small" href={screenToHash('setup')} sx={{ whiteSpace: 'nowrap' }}>
        {hasSessionTakes ? 'Continue' : 'Start'}
      </Button>
    </nav>
  )
}
