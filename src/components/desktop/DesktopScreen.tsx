import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { desktopBridge, type DesktopBridge } from '../../desktop/bridge'
import { AutoTuneScreen } from './autotune/AutoTuneScreen'
import type { OpenTuneSession } from './autotune/useTuneRun'
import { BridgeContext } from './bridgeContext'
import { DesktopNav, type DesktopPage } from './DesktopNav'
import { DriverInstallPanel } from './DriverInstallPanel'
import { EngineFooter } from './EngineFooter'
import { UpdateCheckButton } from './UpdateCheckButton'
import { LiveTuning } from './tuning/LiveTuning'

interface DesktopScreenProps {
  bridge?: DesktopBridge
  /** 'autotune' = #/desktop (the app opens on it), 'live' = #/desktop/live. */
  page?: DesktopPage
  /** The tune session glue (tests pass a fake). */
  openSession?: OpenTuneSession
}

/** Routes #/desktop and #/desktop/live, shown only inside the desktop app: nav, title, the page, engine info footer. */
export function DesktopScreen({ bridge = desktopBridge, page = 'autotune', openSession }: DesktopScreenProps) {
  const { t } = useTranslation()
  return (
    <BridgeContext value={bridge}>
      <div className="mx-auto grid w-full max-w-[1100px] gap-4 py-6">
        <DesktopNav page={page} />
        {page === 'autotune' ? (
          <>
            <div className="grid gap-1">
              <Typography variant="h4" component="h1">{t('desktop.autotune.ui.title')}</Typography>
              <Typography color="text.secondary">{t('desktop.autotune.ui.subtitle')}</Typography>
            </div>
            <DriverInstallPanel />
            <AutoTuneScreen openSession={openSession} />
          </>
        ) : (
          <>
            <Typography variant="h4" component="h1">{t('desktop.title')}</Typography>
            <LiveTuning />
          </>
        )}
        <EngineFooter load={bridge.engineInfo} />
        <UpdateCheckButton />
      </div>
    </BridgeContext>
  )
}
