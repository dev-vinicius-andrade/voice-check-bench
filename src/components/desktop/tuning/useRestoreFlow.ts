import { useState } from 'react'
import type { DesktopBridge } from '../../../desktop/bridge'
import { errorCode, errorMsg } from '../../../desktop/errors'
import type { WlBackupInfo, WlFlowReport } from '../../../desktop/types'
import type { Msg } from '../../../plain/types'

export type RestoreStep =
  | { step: 'closed' }
  | { step: 'loading' }
  | { step: 'pick'; backups: WlBackupInfo[]; selected: string | null }
  | { step: 'restoring'; path: string }
  /** Wave Link did not close by itself: ask before closing it by force. */
  | { step: 'force'; path: string }
  | { step: 'done'; report: WlFlowReport }
  | { step: 'error'; msg: Msg }

export interface RestoreFlow {
  state: RestoreStep
  open(): Promise<void>
  select(path: string): void
  confirm(force: boolean): Promise<void>
  close(): void
}

/** "Restore backup": list the backups, confirm one, write it back (second confirmation to force-close Wave Link). */
export function useRestoreFlow(bridge: DesktopBridge): RestoreFlow {
  const [state, setState] = useState<RestoreStep>({ step: 'closed' })

  const open = async (): Promise<void> => {
    setState({ step: 'loading' })
    try {
      const backups = await bridge.wavelinkBackups()
      setState({ step: 'pick', backups, selected: backups[0]?.path ?? null })
    } catch (e) {
      setState({ step: 'error', msg: errorMsg(e) })
    }
  }

  const select = (path: string): void => setState((s) => (s.step === 'pick' ? { ...s, selected: path } : s))

  const confirm = async (force: boolean): Promise<void> => {
    const path = state.step === 'pick' ? state.selected : state.step === 'force' ? state.path : null
    if (!path) return
    setState({ step: 'restoring', path })
    try {
      setState({ step: 'done', report: await bridge.wavelinkRestore(path, force) })
    } catch (e) {
      setState(errorCode(e) === 'closeTimeout' && !force ? { step: 'force', path } : { step: 'error', msg: errorMsg(e) })
    }
  }

  return { state, open, select, confirm, close: () => setState({ step: 'closed' }) }
}
