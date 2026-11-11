import { afterEach, describe, expect, it, vi } from 'vitest'
import fixture from './audioFrame.fixture.json'
import {
  audioDevices,
  audioExportStates,
  audioLoadState,
  audioSetBypass,
  audioSetGain,
  audioSetMonitor,
  audioSetParam,
  audioStart,
  audioStatus,
  audioStop,
  engineInfo,
  isDesktop,
  wavelinkBackups,
  wavelinkExport,
  wavelinkPreview,
  wavelinkRead,
  wavelinkRestore,
} from './bridge'
import type { AudioFrame, EngineInfo } from './types'

const invoke = vi.fn()
/** Stand-in for the Tauri Channel: keeps the handler so tests can push messages. */
class FakeChannel {
  static last: FakeChannel | null = null
  onmessage: (msg: ArrayBuffer) => void
  constructor(onmessage: (msg: ArrayBuffer) => void) {
    this.onmessage = onmessage
    FakeChannel.last = this
  }
}
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args), Channel: FakeChannel }))

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

describe('audio commands', () => {
  it('invoke the audio_* commands with camelCase arguments', async () => {
    invoke.mockResolvedValue(null)
    await audioDevices()
    await audioStop()
    await audioSetParam(5, 11, 3.98)
    await audioSetBypass(9, false)
    await audioLoadState(6, 'QQ==')
    await audioSetMonitor('raw')
    await audioSetGain(-10)
    await expect(audioStatus()).resolves.toBeNull()
    await audioExportStates()
    expect(invoke.mock.calls).toEqual([
      ['audio_devices'],
      ['audio_stop'],
      ['audio_set_param', { slot: 5, id: 11, value: 3.98 }],
      ['audio_set_bypass', { slot: 9, bypassed: false }],
      ['audio_load_state', { slot: 6, parameterState: 'QQ==' }],
      ['audio_set_monitor', { monitor: 'raw' }],
      ['audio_set_gain', { gainDb: -10 }],
      ['audio_status'],
      ['audio_export_states'],
    ])
  })

  it('audioStart passes a channel and decodes its binary frames', async () => {
    invoke.mockResolvedValue({ monitor: 'off' })
    const frames: AudioFrame[] = []
    await audioStart({ outputId: 'wasapi:x', monitor: 'processed' }, (f) => frames.push(f))
    const [cmd, args] = invoke.mock.calls[0] as [string, Record<string, unknown>]
    expect(cmd).toBe('audio_start')
    expect(args).toMatchObject({ inputId: null, outputId: 'wasapi:x', monitor: 'processed', gainDb: null })
    expect(args.onFrame).toBe(FakeChannel.last)

    const hex = fixture.hex
    const bytes = new Uint8Array(hex.length / 2).map((_, i) => parseInt(hex.slice(2 * i, 2 * i + 2), 16))
    FakeChannel.last!.onmessage(bytes.buffer)
    FakeChannel.last!.onmessage(new ArrayBuffer(8))
    expect(frames).toHaveLength(1)
    expect(frames[0].latencySamples).toBe(4576)
  })
})

describe('wavelink commands', () => {
  it('invoke the wavelink_* commands with camelCase arguments', async () => {
    invoke.mockResolvedValue([])
    const changes = [{ inputKey: 'PCM_IN_01', index: 2, parameterState: 'QQ==' }]
    await wavelinkRead()
    await wavelinkPreview(changes)
    await wavelinkExport(changes, 'abc', false)
    await wavelinkBackups()
    await wavelinkRestore('C:/b.json', true)
    expect(invoke.mock.calls).toEqual([
      ['wavelink_read'],
      ['wavelink_preview', { changes }],
      ['wavelink_export', { changes, expectedHash: 'abc', force: false }],
      ['wavelink_backups'],
      ['wavelink_restore', { path: 'C:/b.json', force: true }],
    ])
  })
})
