import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import { useTranslation } from 'react-i18next'
import { screenToHash } from '../../hooks/useHashRoute'

export type DesktopPage = 'autotune' | 'live'

/** The desktop app's two screens: Tune from a recording (#/desktop) and Fine-tune live (#/desktop/live). */
export function DesktopNav({ page }: { page: DesktopPage }) {
  const { t } = useTranslation()
  return (
    <Tabs value={page} aria-label={t('desktop.autotune.ui.nav.label')} variant="scrollable" allowScrollButtonsMobile>
      <Tab value="autotune" label={t('desktop.autotune.ui.nav.record')} component="a" href={screenToHash('desktop')} />
      <Tab value="live" label={t('desktop.autotune.ui.nav.live')} component="a" href={screenToHash('desktopLive')} />
    </Tabs>
  )
}
