import { useState } from 'react'
import { allChanges, type ManualEdit } from '../../../desktop/autotune/manualEq'
import type { DesktopBridge } from '../../../desktop/bridge'
import type { TuneResult } from '../../../desktop/tune'
import type { WlChainEntry, WlFlowReport } from '../../../desktop/types'
import { useExportFlow, type SaveFlow } from '../tuning/useSaveFlow'
import type { TuneRun } from './useTuneRun'

/** What the last finished export did: wrote and verified the file, or found nothing to write. */
export type SaveOutcome = 'saved' | 'unchanged'

/** 'saved' only when the file was written and checked after; 'unchanged' when nothing had to be written; null otherwise. */
export function saveOutcome(report: WlFlowReport): SaveOutcome | null {
  if (!report.written) return 'unchanged'
  return report.steps.includes('verified') ? 'saved' : null
}

export interface TuneSave {
  flow: SaveFlow
  /** The entries the changes apply to (for the diff lines). */
  entries: readonly WlChainEntry[]
  /** An export finished, wrote the file and verified it. */
  saved: boolean
  /** An export finished without writing: Wave Link already had these settings. */
  unchanged: boolean
  reset(): void
}

const NO_EDITS: readonly ManualEdit[] = []

/**
 * "Save to Wave Link" of a tune result with the hand edits on top (`allChanges`): the session's exportChanges → the
 * live screen's preview / confirm / export flow. The outcome is that of these changes: an edit clears "saved". A file changed since the recording was tuned (Wave Link, or a save from this screen) is said in this screen's
 * words: the live screen's "press Stop and Start" does not exist here.
 */
export function useTuneSave(bridge: DesktopBridge, run: TuneRun, result: TuneResult | null, edits: readonly ManualEdit[] = NO_EDITS): TuneSave {
  const [outcome, setOutcome] = useState<SaveOutcome | null>(null)
  const [savedEdits, setSavedEdits] = useState(edits)
  // other hand edits than when the outcome was said: it no longer says anything about them
  if (savedEdits !== edits) {
    setSavedEdits(edits)
    setOutcome(null)
  }
  // the file's hash after this screen's own last save of this session's snapshot: a save after "adjust" checks
  // against it, not against the hash read before the first save (that one would fail as "changed meanwhile")
  const [written, setWritten] = useState<{ from: string; hash: string } | null>(null)
  const snap = run.snapshot
  const flow = useExportFlow(
    bridge,
    async () => {
      if (!result || !snap) throw new Error('nothing to save')
      const changes = await run.exportChanges(allChanges(result.changes, edits))
      return { plan: { changes, unsaved: [] }, hash: written?.from === snap.hash ? written.hash : snap.hash }
    },
    (report) => {
      const o = saveOutcome(report)
      setOutcome(o)
      if (o === 'saved' && snap && report.hash) setWritten({ from: snap.hash, hash: report.hash })
    },
  )
  const s = flow.state
  const state = s.step === 'error' && s.msg.key === 'desktop.errors.changedMeanwhile' ? { ...s, msg: { key: 'desktop.autotune.ui.result.changedMeanwhile' } } : s
  const key = s.step === 'confirm' ? s.plan.changes[0]?.inputKey : undefined
  const input = snap?.inputs.find((i) => i.key === key) ?? snap?.inputs[0]
  return {
    flow: { ...flow, state },
    entries: input?.entries ?? [],
    saved: outcome === 'saved',
    unchanged: outcome === 'unchanged',
    reset: () => setOutcome(null),
  }
}
