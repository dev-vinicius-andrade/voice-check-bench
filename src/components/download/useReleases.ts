// Desktop releases from GitHub with an explicit loading state, fetched once per page visit.
import { useEffect, useState } from 'react'
import { loadReleases, type DesktopRelease } from '../../downloads/releases'

export type ReleasesStatus =
  | { status: 'loading' }
  | { status: 'ready'; releases: DesktopRelease[] }
  | { status: 'unavailable' }

export function useReleases(): ReleasesStatus {
  const [state, setState] = useState<ReleasesStatus>({ status: 'loading' })
  useEffect(() => {
    let alive = true
    void loadReleases().then((releases) => {
      if (alive) setState(releases && releases.length > 0 ? { status: 'ready', releases } : { status: 'unavailable' })
    })
    return () => {
      alive = false
    }
  }, [])
  return state
}
