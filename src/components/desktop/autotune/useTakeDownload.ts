import { useState } from 'react'
import type { SaveWav } from '../../../desktop/bridge'
import { downloadErrorMsg, takeFileName, takeWav, type TakeSide } from '../../../desktop/autotune/takeFile'
import type { Msg } from '../../../plain/types'

export type TakeDownloadState =
  | { step: 'idle' }
  | { step: 'saving'; side: TakeSide }
  | { step: 'saved'; side: TakeSide; path: string }
  | { step: 'error'; side: TakeSide; msg: Msg }

export interface TakeDownload {
  state: TakeDownloadState
  /** Encode `samples` as a WAV and save it to the Downloads folder as `voice-check-<side>-<date>.wav`. */
  save(side: TakeSide, samples: Float32Array): Promise<void>
}

/** "Download" of Before / After: one file at a time through `write` (bridge saveWav), the path it was saved to or a plain error. */
export function useTakeDownload(write: SaveWav, now: () => Date = () => new Date()): TakeDownload {
  const [state, setState] = useState<TakeDownloadState>({ step: 'idle' })
  const save = async (side: TakeSide, samples: Float32Array): Promise<void> => {
    if (state.step === 'saving') return
    setState({ step: 'saving', side })
    try {
      const path = await write(takeFileName(side, now()), takeWav(samples))
      setState({ step: 'saved', side, path })
    } catch (e) {
      setState({ step: 'error', side, msg: downloadErrorMsg(e) })
    }
  }
  return { state, save }
}
