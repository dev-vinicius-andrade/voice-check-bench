import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { desktopBridge, type DesktopBridge } from '../../desktop/bridge'
import { BridgeContext } from './bridgeContext'
import { EngineFooter } from './EngineFooter'
import { LiveTuning } from './tuning/LiveTuning'

/** Route #/desktop, shown only inside the desktop app: the live tuning screen, engine info in a footer line. */
export function DesktopScreen({ bridge = desktopBridge }: { bridge?: DesktopBridge }) {
  const { t } = useTranslation()
  return (
    <BridgeContext value={bridge}>
      <div className="mx-auto grid w-full max-w-[1100px] gap-4 py-6">
        <Typography variant="h4" component="h1">{t('desktop.title')}</Typography>
        <LiveTuning />
        <EngineFooter load={bridge.engineInfo} />
      </div>
    </BridgeContext>
  )
}
