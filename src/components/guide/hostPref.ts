// "What do you use for your mic?" answer of the guide, saved in localStorage 'vcb-host' (fails soft when storage is blocked).
import { useCallback, useState } from 'react'
import { readPref, writePref } from '../../storage/prefs'

export type Host = 'wavelink' | 'obs' | 'apps' | 'nvidia' | 'unsure'

export const HOSTS: readonly Host[] = ['wavelink', 'obs', 'apps', 'nvidia', 'unsure']
export const HOST_KEY = 'vcb-host'

/** Saved host, or null when none was picked yet (or the saved value is not a known host). */
export function loadHost(): Host | null {
  const raw = readPref<unknown>(HOST_KEY, null)
  return HOSTS.find((h) => h === raw) ?? null
}

export function saveHost(h: Host | null): void {
  if (h === null) {
    try {
      localStorage.removeItem(HOST_KEY)
    } catch {
      // storage blocked: ignore
    }
    return
  }
  writePref(HOST_KEY, h)
}

/** The saved host plus a setter that persists it. */
export function useHost(): [Host | null, (h: Host | null) => void] {
  const [host, setHost] = useState<Host | null>(loadHost)
  const set = useCallback((h: Host | null) => {
    saveHost(h)
    setHost(h)
  }, [])
  return [host, set]
}
