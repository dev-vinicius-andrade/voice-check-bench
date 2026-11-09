// Profiles list for the page: loads from the profiles store and reloads after each change.
import { useEffect, useState } from 'react'
import { openProfilesStore } from '../../profiles/store'
import type { Profile } from '../../profiles/types'

export interface ProfilesApi {
  /** null while loading. */
  profiles: Profile[] | null
  put(p: Profile): Promise<void>
  remove(id: string): Promise<void>
  setActive(id: string): Promise<void>
}

export function useProfiles(): ProfilesApi {
  const [profiles, setProfiles] = useState<Profile[] | null>(null)
  const load = (): Promise<Profile[]> => openProfilesStore().then((s) => s.list()).catch(() => [])
  const reload = async (): Promise<void> => setProfiles(await load())
  useEffect(() => {
    let live = true
    void load().then((ps) => {
      if (live) setProfiles(ps)
    })
    return () => {
      live = false
    }
  }, [])
  /** Runs one store operation, then reloads the list (also after a failure, so the page shows what is stored). */
  const run = async (op: (s: Awaited<ReturnType<typeof openProfilesStore>>) => Promise<void>): Promise<void> => {
    try {
      await op(await openProfilesStore())
    } finally {
      await reload()
    }
  }
  return {
    profiles,
    put: (p) => run((s) => s.put(p)),
    remove: (id) => run((s) => s.delete(id)),
    setActive: (id) => run((s) => s.setActive(id)),
  }
}
