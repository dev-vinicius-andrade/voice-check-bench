import { useRef, useState } from 'react'
import type { DesktopBridge } from '../../../desktop/bridge'
import { errorCode, errorMsg } from '../../../desktop/errors'
import { asListed, exportPlan, type ExportPlan } from '../../../desktop/exportPlan'
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

/** What to write and the Settings.json hash it was planned against (wavelink_export refuses a file changed since). */
export interface SavePlan {
  plan: ExportPlan
  hash: string
}

/**
 * The Save state machine for any plan: `prepare` (→ diff via wavelink_preview) → confirm → export, with a second
 * confirmation to force-close Wave Link; `onDone` gets the report of a finished export.
 */
export function useExportFlow(
  bridge: Pick<DesktopBridge, 'wavelinkPreview' | 'wavelinkExport'>,
  prepare: () => Promise<SavePlan>,
  onDone?: (report: WlFlowReport) => void,
): SaveFlow {
  const [state, setState] = useState<SaveStep>({ step: 'closed' })
  const hash = useRef('')

  const open = async (): Promise<void> => {
    setState({ step: 'loading' })
    try {
      const p = await prepare()
      hash.current = p.hash
      const lines = p.plan.changes.length ? await bridge.wavelinkPreview(p.plan.changes) : []
      setState({ step: 'confirm', plan: p.plan, lines })
    } catch (e) {
      setState({ step: 'error', msg: errorMsg(e) })
    }
  }

  const confirm = async (force: boolean): Promise<void> => {
    if (state.step !== 'confirm' && state.step !== 'force') return
    const { plan } = state
    // never a silent no-op: without the hash the file was read with, nothing can be written safely
    if (!hash.current) return setState({ step: 'error', msg: { key: 'desktop.errors.notFound' } })
    setState({ step: 'saving', plan })
    try {
      const report = await bridge.wavelinkExport(plan.changes, hash.current, force)
      setState({ step: 'done', report })
      onDone?.(report)
    } catch (e) {
      setState(errorCode(e) === 'closeTimeout' && !force ? { step: 'force', plan } : { step: 'error', msg: errorMsg(e) })
    }
  }

  return { state, open, confirm, close: () => setState({ step: 'closed' }) }
}

/** "Save to Wave Link" of the live chain: the engine's state export → exportPlan, then useExportFlow; re-reads the file after. */
export function useSaveFlow(bridge: DesktopBridge, model: ChainModel | null, onSaved: (snap: WlSnapshot) => void): SaveFlow {
  const flow = useExportFlow(
    bridge,
    async () => {
      if (!model?.entries || !model.inputKey) throw new Error('no Wave Link chain')
      // Elgato states come from the engine; when it is stopped they cannot be read and are listed as not saved
      const exported = await bridge.audioExportStates().catch(() => null)
      // as Wave Link lists them: a plugin switched on off its own bypass is written with the state that clears it
      const { start, chain } = asListed(model.start, model.undo.chain, model.ownBypassed)
      return { plan: exportPlan(model.inputKey, start, chain, model.slots, model.entries, exported), hash: model.hash ?? '' }
    },
    () => void bridge.wavelinkRead().then(onSaved, () => undefined),
  )
  return { ...flow, open: () => (model?.entries && model.inputKey ? flow.open() : Promise.resolve()) }
}
