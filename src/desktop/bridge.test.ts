import { afterEach, describe, expect, it, vi } from 'vitest'
import { engineInfo, isDesktop } from './bridge'
import type { EngineInfo } from './types'

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }))

const tauriWindow = window as unknown as Record<string, unknown>

afterEach(() => {
  delete tauriWindow.__TAURI_INTERNALS__
  invoke.mockReset()
})

describe('isDesktop', () => {
  it('is false in a plain browser', () => {
    expect(isDesktop()).toBe(false)
  })

  it('is true when the Tauri internals are injected', () => {
    tauriWindow.__TAURI_INTERNALS__ = {}
    expect(isDesktop()).toBe(true)
  })
})

describe('engineInfo', () => {
  it("invokes the 'engine_info' command and returns its result", async () => {
    const info: EngineInfo = { appVersion: '0.1.0', rustVersion: 'rustc 1.99.1', os: 'windows', arch: 'x86_64' }
    invoke.mockResolvedValue(info)
    await expect(engineInfo()).resolves.toEqual(info)
    expect(invoke).toHaveBeenCalledWith('engine_info')
  })
})
