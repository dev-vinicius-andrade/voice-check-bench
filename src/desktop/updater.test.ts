import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (e: { event: string; data?: { contentLength?: number; chunkLength?: number } }) => void
const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  relaunch: vi.fn(),
}))
vi.mock('@tauri-apps/plugin-updater', () => ({ check: mocks.check }))
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: mocks.relaunch }))

import { checkForUpdate } from './updater'

const tauriWindow = window as unknown as Record<string, unknown>

function fakeUpdate(install: (h: Handler) => Promise<void> = async () => {}) {
  return {
    version: '2.0.0-alpha.2',
    body: 'notes',
    downloadAndInstall: vi.fn(install),
    close: vi.fn(async () => {}),
  }
}

beforeEach(() => {
  tauriWindow.__TAURI_INTERNALS__ = {}
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  delete tauriWindow.__TAURI_INTERNALS__
  vi.restoreAllMocks()
  mocks.check.mockReset()
  mocks.relaunch.mockReset()
})

describe('checkForUpdate', () => {
  it('is null on the web without loading the plugin', async () => {
    delete tauriWindow.__TAURI_INTERNALS__
    expect(await checkForUpdate()).toBeNull()
    expect(mocks.check).not.toHaveBeenCalled()
  })

  it('is null when up to date or when the check fails', async () => {
    mocks.check.mockResolvedValueOnce(null)
    expect(await checkForUpdate()).toBeNull()
    mocks.check.mockRejectedValueOnce(new Error('offline'))
    expect(await checkForUpdate()).toBeNull()
    expect(console.warn).toHaveBeenCalled()
  })

  it('downloads with progress, installs and relaunches', async () => {
    const u = fakeUpdate(async (h) => {
      h({ event: 'Started', data: { contentLength: 100 } })
      h({ event: 'Progress', data: { chunkLength: 40 } })
      h({ event: 'Progress', data: { chunkLength: 60 } })
      h({ event: 'Finished' })
    })
    mocks.check.mockResolvedValue(u)
    const update = await checkForUpdate()
    expect(update?.version).toBe('2.0.0-alpha.2')
    expect(update?.notes).toBe('notes')
    const seen: Array<{ downloaded: number; total: number | null }> = []
    expect(await update?.install((p) => seen.push(p))).toBe(true)
    expect(seen.map((p) => p.downloaded)).toEqual([0, 40, 100, 100])
    expect(seen[0].total).toBe(100)
    expect(mocks.relaunch).toHaveBeenCalledOnce()
  })

  it('install failures are soft and skip the relaunch', async () => {
    mocks.check.mockResolvedValue(fakeUpdate(async () => Promise.reject(new Error('bad signature'))))
    const update = await checkForUpdate()
    expect(await update?.install()).toBe(false)
    expect(mocks.relaunch).not.toHaveBeenCalled()
  })

  it('a failed relaunch resolves false; dismiss closes the update', async () => {
    const u = fakeUpdate()
    mocks.check.mockResolvedValue(u)
    mocks.relaunch.mockRejectedValue(new Error('nope'))
    const update = await checkForUpdate()
    expect(await update?.install()).toBe(false)
    await update?.dismiss()
    expect(u.close).toHaveBeenCalledOnce()
  })
})
