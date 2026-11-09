// Community index with an explicit loading state (useCommunityIndex returns null for both loading and missing).
import { useEffect, useState } from 'react'
import { loadCommunityIndex } from '../../community/useCommunity'
import type { CommunityIndex } from '../../community/types'

export type CommunityIndexStatus =
  | { status: 'loading' }
  | { status: 'ready'; index: CommunityIndex }
  | { status: 'unavailable' }

export function useCommunityIndexStatus(): CommunityIndexStatus {
  const [state, setState] = useState<CommunityIndexStatus>({ status: 'loading' })
  useEffect(() => {
    let alive = true
    void loadCommunityIndex().then((index) => {
      if (alive) setState(index ? { status: 'ready', index } : { status: 'unavailable' })
    })
    return () => {
      alive = false
    }
  }, [])
  return state
}
