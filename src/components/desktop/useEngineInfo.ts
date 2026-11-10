import { useEffect, useState } from 'react'
import { engineInfo } from '../../desktop/bridge'
import type { EngineInfo } from '../../desktop/types'

export type EngineInfoState = { status: 'loading' } | { status: 'ready'; info: EngineInfo } | { status: 'error'; message: string }

/** Asks the Rust engine for its info once per mount. `load` is injectable for tests. */
export function useEngineInfo(load: () => Promise<EngineInfo> = engineInfo): EngineInfoState {
  const [state, setState] = useState<EngineInfoState>({ status: 'loading' })
  useEffect(() => {
    let alive = true
    load().then(
      (info) => alive && setState({ status: 'ready', info }),
      (e: unknown) => alive && setState({ status: 'error', message: e instanceof Error ? e.message : String(e) }),
    )
    return () => {
      alive = false
    }
  }, [load])
  return state
}
