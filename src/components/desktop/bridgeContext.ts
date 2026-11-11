// The desktop bridge the screens talk to; tests provide a fake through <BridgeContext value={fake}>.
import { createContext, useContext } from 'react'
import { desktopBridge, type DesktopBridge } from '../../desktop/bridge'

export const BridgeContext = createContext<DesktopBridge>(desktopBridge)

export const useBridge = (): DesktopBridge => useContext(BridgeContext)
