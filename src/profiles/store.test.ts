import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mic } from '../plain/testFixtures'
import { suggestionFixture } from '../wavelink/testFixtures'
import { profileFromSession } from './build'
import { openProfilesStore } from './store'
import type { Profile } from './types'

const profile = (id: string, created: string, name = id): Profile =>
  profileFromSession({
    id,
    name,
    now: new Date(created),
    mic: mic(),
    host: 'obs',
    dist: '8 cm',
    goal: { style: 'clear', perceived: [] },
    mains: 50,
    suggestion: suggestionFixture(),
    raw: null,
    fx: null,
  })

beforeEach(async () => {
  vi.stubGlobal('indexedDB', undefined)
  const s = await openProfilesStore()
  for (const p of await s.list()) await s.delete(p.id)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('profiles store without IndexedDB (memory)', () => {
  it('lists, gets, replaces and deletes profiles', async () => {
    const s = await openProfilesStore()
    expect(s.available).toBe(false)
    await s.put(profile('b', '2026-02-01T00:00:00Z'))
    await s.put(profile('a', '2026-01-01T00:00:00Z'))
    expect((await s.list()).map((p) => p.id)).toEqual(['a', 'b'])
    expect((await s.get('a'))?.name).toBe('a')
    expect(await s.get('zzz')).toBeNull()
    await s.put({ ...profile('a', '2026-01-01T00:00:00Z'), name: 'Renamed' })
    expect((await s.get('a'))?.name).toBe('Renamed')
    await s.delete('a')
    expect((await s.list()).map((p) => p.id)).toEqual(['b'])
  })

  it('shares the memory between opens', async () => {
    await (await openProfilesStore()).put(profile('x', '2026-01-01T00:00:00Z'))
    expect((await (await openProfilesStore()).list()).map((p) => p.id)).toEqual(['x'])
  })

  it('keeps exactly one active profile', async () => {
    const s = await openProfilesStore()
    await s.put(profile('a', '2026-01-01T00:00:00Z'))
    await s.put(profile('b', '2026-01-02T00:00:00Z'))
    await s.setActive('a')
    expect((await s.list()).map((p) => !!p.active)).toEqual([true, false])
    await s.setActive('b')
    expect((await s.list()).map((p) => !!p.active)).toEqual([false, true])
    await s.setActive(null)
    expect((await s.list()).some((p) => p.active)).toBe(false)
    expect(await s.get('a')).not.toHaveProperty('active')
  })

  it('refuses to store an invalid profile', async () => {
    const s = await openProfilesStore()
    await expect(s.put({ ...profile('a', '2026-01-01T00:00:00Z'), name: '' })).rejects.toThrow()
    expect(await s.list()).toEqual([])
  })
})
