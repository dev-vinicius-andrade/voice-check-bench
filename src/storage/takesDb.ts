// IndexedDB persistence for takes (same DB/store names as the prototype). Fails soft to memory.
import type { MicProfile, StepKey, StoredTake } from '../types'

const DB_NAME = 'voice-check-bench'
const DB_VERSION = 1
const STORE = 'takes'
const STEP_KEYS: readonly StepKey[] = ['c2', 'c8', 'c15', 'fx']

export interface TakesDb {
  available: boolean
  all(): Promise<StoredTake[]>
  put(t: StoredTake): Promise<void>
  remove(id: number): Promise<void>
  clear(): Promise<void>
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

function toSamples(v: unknown): Float32Array | null {
  if (v instanceof Float32Array) return v
  if (v instanceof ArrayBuffer) return new Float32Array(v)
  if (Array.isArray(v) && v.every((n) => typeof n === 'number')) return Float32Array.from(v)
  return null
}

/** Normalizes a stored record (current or prototype shape {sr, x}) to StoredTake; null if unusable. */
export function normalizeRecord(raw: unknown): StoredTake | null {
  if (!isObject(raw) || typeof raw.id !== 'number') return null
  const samples = toSamples(raw.samples ?? raw.x)
  const sampleRate = typeof raw.sampleRate === 'number' ? raw.sampleRate : raw.sr
  if (!samples || typeof sampleRate !== 'number' || !(sampleRate > 0)) return null
  const step = STEP_KEYS.find((k) => k === raw.step) ?? null
  return {
    id: raw.id,
    name: typeof raw.name === 'string' ? raw.name : `Take ${raw.id}`,
    session: typeof raw.session === 'string' ? raw.session : 'free',
    step,
    device: typeof raw.device === 'string' ? raw.device : '',
    sampleRate,
    samples,
    created: typeof raw.created === 'string' ? raw.created : new Date(raw.id).toISOString(),
    ...(toMic(raw.mic) ? { mic: toMic(raw.mic)! } : {}),
  }
}

const MIC_KINDS: readonly MicProfile['kind'][] = ['dynamic', 'condenser', 'unknown']
const MIC_PATTERNS: readonly MicProfile['pattern'][] = ['cardioid', 'supercardioid', 'omni', 'figure8', 'unknown']
const MIC_ADDRESSES: readonly MicProfile['address'][] = ['end', 'side', 'unknown']

/** Validates a stored mic profile; null when absent or malformed. */
function toMic(raw: unknown): MicProfile | null {
  if (!isObject(raw) || typeof raw.model !== 'string') return null
  const kind = MIC_KINDS.find((k) => k === raw.kind) ?? 'unknown'
  const pattern = MIC_PATTERNS.find((p) => p === raw.pattern) ?? 'unknown'
  const address = MIC_ADDRESSES.find((a) => a === raw.address) ?? 'unknown'
  return { model: raw.model, kind, pattern, address }
}

/** Copies only the StoredTake fields, so an in-memory `analysis` is never persisted. */
function toRecord(t: StoredTake): StoredTake {
  const { id, name, session, step, device, sampleRate, samples, created, mic } = t
  return { id, name, session, step, device, sampleRate, samples, created, ...(mic ? { mic } : {}) }
}

function memoryDb(): TakesDb {
  const map = new Map<number, StoredTake>()
  return {
    available: false,
    all: async () => [...map.values()].sort((a, b) => a.id - b.id),
    put: async (t) => {
      map.set(t.id, toRecord(t))
    },
    remove: async (id) => {
      map.delete(id)
    },
    clear: async () => {
      map.clear()
    },
  }
}

const request = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((res, rej) => {
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })

function idbDb(db: IDBDatabase): TakesDb {
  const store = (mode: IDBTransactionMode) => db.transaction(STORE, mode).objectStore(STORE)
  const write = async (fn: (s: IDBObjectStore) => IDBRequest): Promise<void> => {
    await request(fn(store('readwrite')))
  }
  return {
    available: true,
    all: async () => {
      const rows = await request(store('readonly').getAll())
      return rows
        .map(normalizeRecord)
        .filter((t): t is StoredTake => t !== null)
        .sort((a, b) => a.id - b.id)
    },
    put: (t) => write((s) => s.put(toRecord(t))),
    remove: (id) => write((s) => s.delete(id)),
    clear: () => write((s) => s.clear()),
  }
}

export async function openTakesDb(): Promise<TakesDb> {
  try {
    if (typeof indexedDB === 'undefined' || !indexedDB) return memoryDb()
    const open = indexedDB.open(DB_NAME, DB_VERSION)
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE, { keyPath: 'id' })
    }
    return idbDb(await request(open))
  } catch {
    return memoryDb()
  }
}
