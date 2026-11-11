import { useState } from 'react'
import type { DesktopBridge } from '../../../desktop/bridge'
import { errorCode, errorMsg } from '../../../desktop/errors'
import { exportPlan, type ExportPlan } from '../../../desktop/exportPlan'
import type { WlDiffLine, WlFlowReport, WlSnapshot } from '../../../desktop/types'
import type { Msg } from '../../../plain/types'
import type { ChainModel } from './useChainState'

export type SaveStep =
  | { step: 'closed' }
  | { step: 'loading' }
  | { step: 'confirm'; plan: ExportPlan; lines: WlDiffLine[] }
  | { step: 'saving'; plan: ExportPlan }
  /** Wave Link did not close by itself: ask before closing it by force. */
  | { step: 'force'; plan: ExportPlan }
  | { step: 'done'; report: WlFlowReport }
  | { step: 'error'; msg: Msg }

export interface SaveFlow {
  state: SaveStep
  open(): Promise<void>
  confirm(force: boolean): Promise<void>
  close(): void
}

/** "Save to Wave Link": diff (wavelink_preview) → confirm → export, with a second confirmation to force-close Wave Link. */
export function useSaveFlow(bridge: DesktopBridge, model: ChainModel | null, onSaved: (snap: WlSnapshot) => void): SaveFlow {
  const [state, setState] = useState<SaveStep>({ step: 'closed' })

  const open = async (): Promise<void> => {
    if (!model?.entries || !model.inputKey) return
    setState({ step: 'loading' })
    // Elgato states come from the engine; when it is stopped they cannot be read and are listed as not saved
    const exported = await bridge.audioExportStates().catch(() => null)
    const plan = exportPlan(model.inputKey, model.start, model.undo.chain, model.slots, model.entries, exported)
    try {
      const lines = plan.changes.length ? await bridge.wavelinkPreview(plan.changes) : []
      setState({ step: 'confirm', plan, lines })
    } catch (e) {
      setState({ step: 'error', msg: errorMsg(e) })
    }
  }

  const confirm = async (force: boolean): Promise<void> => {
    if ((state.step !== 'confirm' && state.step !== 'force') || !model?.hash) return
    const { plan } = state
    setState({ step: 'saving', plan })
    try {
      const report = await bridge.wavelinkExport(plan.changes, model.hash, force)
      setState({ step: 'done', report })
      bridge.wavelinkRead().then(onSaved, () => undefined)
    } catch (e) {
      setState(errorCode(e) === 'closeTimeout' && !force ? { step: 'force', plan } : { step: 'error', msg: errorMsg(e) })
    }
  }

  return { state, open, confirm, close: () => setState({ step: 'closed' }) }
}
