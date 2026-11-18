import { useState } from 'react'
import type { DesktopBridge } from '../../../desktop/bridge'
import type { TuneResult } from '../../../desktop/tune'
import type { WlChainEntry } from '../../../desktop/types'
import { useExportFlow, type SaveFlow } from '../tuning/useSaveFlow'
import type { TuneRun } from './useTuneRun'

export interface TuneSave {
  flow: SaveFlow
  /** The entries the changes apply to (for the diff lines). */
  entries: readonly WlChainEntry[]
  /** An export finished and wrote the file. */
  saved: boolean
  reset(): void
}

/** "Save to Wave Link" of a tune result: the session's exportChanges → the live screen's preview / confirm / export flow. */
export function useTuneSave(bridge: DesktopBridge, run: TuneRun, result: TuneResult | null): TuneSave {
  const [saved, setSaved] = useState(false)
  const snap = run.snapshot
  const flow = useExportFlow(
    bridge,
    async () => {
      if (!result || !snap) throw new Error('nothing to save')
      const changes = await run.exportChanges(result.changes)
      return { plan: { changes, unsaved: [] }, hash: snap.hash }
    },
    () => setSaved(true),
  )
  const key = flow.state.step === 'confirm' ? flow.state.plan.changes[0]?.inputKey : undefined
  const input = snap?.inputs.find((i) => i.key === key) ?? snap?.inputs[0]
  return { flow, entries: input?.entries ?? [], saved, reset: () => setSaved(false) }
}
