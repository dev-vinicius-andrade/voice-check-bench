// Profiles in IndexedDB (store 'profiles' of the app database, v2) with an in-memory fallback. Framework-free.
// Rows are re-validated on read (parseProfile), so a damaged or older row never reaches the app.
import { PROFILES_STORE, openAppDb } from '../storage/takesDb'
import type { Profile } from './types'
import { parseProfile } from './validate'

export interface ProfilesStore {
  /** False when IndexedDB is unavailable or blocked: profiles live in memory for this page load. */
  available: boolean
  /** All profiles, oldest first (created, then name). */
  list(): Promise<Profile[]>
  get(id: string): Promise<Profile | null>
  /** Insert or replace (by id). Throws when the profile is not valid (it would never be listed). */
  put(p: Profile): Promise<void>
  delete(id: string): Promise<void>
  /** Marks one profile active and clears the others; null clears all. */
  setActive(id: string | null): Promise<void>
}

/** The profile as stored: validated and rebuilt from known keys. */
const checked = (p: Profile): Profile => {
  const ok = parseProfile(p, true)
  if (!ok) throw new Error(`profile ${p.id} is not valid`)
  return ok
}

const byCreated = (a: Profile, b: Profile): number => a.created.localeCompare(b.created) || a.name.localeCompare(b.name)
const valid = (rows: unknown[]): Profile[] => rows.map((r) => parseProfile(r, true)).filter((p): p is Profile => p !== null)

/** Copy with the active flag set or removed. */
const withActive = (p: Profile, on: boolean): Profile => {
  const { active: _drop, ...rest } = p
  void _drop
  return on ? { ...rest, active: true } : rest
}

/** Shared by every memory store of this page, so separate opens see the same profiles. */
const memory = new Map<string, Profile>()

function memoryStore(): ProfilesStore {
  return {
    available: false,
    list: async () => valid([...memory.values()]).sort(byCreated),
    get: async (id) => (memory.has(id) ? parseProfile(memory.get(id), true) : null),
    put: async (p) => {
      memory.set(p.id, checked(p))
    },
    delete: async (id) => {
      memory.delete(id)
    },
    setActive: async (id) => {
      for (const p of memory.values()) memory.set(p.id, withActive(p, p.id === id))
    },
  }
}

const request = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((res, rej) => {
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })

const done = (tx: IDBTransaction): Promise<void> =>
  new Promise((res, rej) => {
    tx.oncomplete = () => res()
    tx.onerror = () => rej(tx.error)
    tx.onabort = () => rej(tx.error)
  })

function idbStore(db: IDBDatabase): ProfilesStore {
  const store = (mode: IDBTransactionMode) => db.transaction(PROFILES_STORE, mode).objectStore(PROFILES_STORE)
  return {
    available: true,
    list: async () => valid(await request(store('readonly').getAll())).sort(byCreated),
    get: async (id) => parseProfile(await request(store('readonly').get(id)), true),
    put: async (p) => {
      await request(store('readwrite').put(checked(p)))
    },
    delete: async (id) => {
      await request(store('readwrite').delete(id))
    },
    setActive: async (id) => {
      const tx = db.transaction(PROFILES_STORE, 'readwrite')
      const s = tx.objectStore(PROFILES_STORE)
      const rows = valid(await request(s.getAll()))
      for (const p of rows) if (!!p.active !== (p.id === id)) s.put(withActive(p, p.id === id))
      await done(tx)
    },
  }
}

/** The profiles store; falls back to memory when IndexedDB is unavailable or fails to open. */
export async function openProfilesStore(): Promise<ProfilesStore> {
  try {
    return idbStore(await openAppDb())
  } catch {
    return memoryStore()
  }
}
