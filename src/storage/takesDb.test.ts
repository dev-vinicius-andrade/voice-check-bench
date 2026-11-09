import { afterEach, describe, expect, it, vi } from 'vitest'
import { DB_VERSION, PROFILES_STORE, normalizeRecord, openAppDb, openTakesDb } from './takesDb'
import type { StoredTake } from '../types'

const take = (id: number): StoredTake => ({
  id,
  name: `Take ${id}`,
  session: 's1',
  step: 'c8',
  device: 'Mic',
  sampleRate: 48000,
  samples: new Float32Array([0.1, -0.2]),
  created: '2026-01-01T00:00:00.000Z',
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('openTakesDb', () => {
  it('falls back to memory when indexedDB is undefined', async () => {
    vi.stubGlobal('indexedDB', undefined)
    const db = await openTakesDb()
    expect(db.available).toBe(false)
    await db.put(take(2))
    await db.put({ ...take(1), analysis: { error: 'x' } } as StoredTake)
    const all = await db.all()
    expect(all.map((t) => t.id)).toEqual([1, 2])
    expect('analysis' in all[0]).toBe(false)
    await db.remove(1)
    expect((await db.all()).map((t) => t.id)).toEqual([2])
    await db.clear()
    expect(await db.all()).toEqual([])
  })
})

describe('normalizeRecord', () => {
  it('maps prototype records (sr, x) to StoredTake', () => {
    const x = new Float32Array([0.5, 0.25])
    const t = normalizeRecord({ id: 10, name: 'Control · 8 cm', session: 's9', step: 'c8', device: 'USB', sr: 44100, x, created: 'c' })
    expect(t).toEqual({ id: 10, name: 'Control · 8 cm', session: 's9', step: 'c8', device: 'USB', sampleRate: 44100, samples: x, created: 'c' })
    expect(t?.samples).toBeInstanceOf(Float32Array)
  })

  it('keeps current-shape records, converts arrays, drops unusable ones', () => {
    expect(normalizeRecord(take(3))).toEqual(take(3))
    expect(normalizeRecord({ ...take(4), samples: [0, 1], step: 'bogus' })?.samples).toEqual(new Float32Array([0, 1]))
    expect(normalizeRecord({ ...take(4), step: 'bogus' })?.step).toBeNull()
    expect(normalizeRecord({ id: 1 })).toBeNull()
    expect(normalizeRecord(null)).toBeNull()
  })
})

describe('mic profile on takes', () => {
  it('keeps a valid mic profile and sanitizes bad fields', () => {
    const base = { id: 1, name: 't', session: 's1', step: 'c2', device: 'd', sampleRate: 48000, samples: new Float32Array(4), created: 'x' }
    expect(normalizeRecord({ ...base, mic: { model: 'Any Mic', kind: 'dynamic', pattern: 'cardioid', address: 'end' } })?.mic).toEqual({ model: 'Any Mic', kind: 'dynamic', pattern: 'cardioid', address: 'end' })
    expect(normalizeRecord({ ...base, mic: { model: 'X', kind: 'laser', pattern: 1 } })?.mic).toEqual({ model: 'X', kind: 'unknown', pattern: 'unknown', address: 'unknown' })
    expect(normalizeRecord(base)?.mic).toBeUndefined()
  })
})

/** Minimal indexedDB.open stub: runs onupgradeneeded against a db that already has `existing` stores, then succeeds. */
function stubOpen(existing: string[]) {
  const created: string[] = []
  const db = {
    objectStoreNames: { contains: (n: string) => existing.includes(n) || created.includes(n) },
    createObjectStore: vi.fn((n: string) => created.push(n)),
    onversionchange: null as null | (() => void),
    close: vi.fn(),
  }
  const open = vi.fn((...args: [string, number]) => {
    void args
    const req: Record<string, unknown> = { result: db }
    queueMicrotask(() => {
      ;(req.onupgradeneeded as () => void)?.()
      ;(req.onsuccess as () => void)?.()
    })
    return req
  })
  vi.stubGlobal('indexedDB', { open })
  return { db, open, created }
}

describe('database version 2', () => {
  it('upgrades a v1 database by adding only the profiles store (takes are kept)', async () => {
    const { db, open, created } = stubOpen(['takes'])
    expect(await openAppDb()).toBe(db)
    expect(open).toHaveBeenCalledWith('voice-check-bench', 2)
    expect(DB_VERSION).toBe(2)
    expect(created).toEqual([PROFILES_STORE])
    db.onversionchange?.()
    expect(db.close).toHaveBeenCalled()
  })

  it('creates both stores on a new database', async () => {
    const { created } = stubOpen([])
    await openAppDb()
    expect(created).toEqual(['takes', 'profiles'])
  })

  it('openAppDb rejects without IndexedDB (callers fall back to memory)', async () => {
    vi.stubGlobal('indexedDB', undefined)
    await expect(openAppDb()).rejects.toThrow()
  })
})
