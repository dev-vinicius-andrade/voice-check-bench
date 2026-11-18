import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import i18n from '../../../i18n'
import en from '../../../i18n/locales/en/desktop.json'
import type { DesktopBridge } from '../../../desktop/bridge'
import { FRAME, framesOf, noise, speech } from '../../../desktop/calibrate/testLive'
import { audioStatus, INPUT_KEY, snapshot } from '../../../desktop/testChain'
import type { AudioFrame, AudioSlot, WlFlowReport } from '../../../desktop/types'
import { theme } from '../../../theme'
import { DesktopScreen } from '../DesktopScreen'

const T = en.desktop.tune
const C = T.calibrate
const ROOM = -40
const VAD = 1163972580

/**
 * A bridge without Tauri whose stream answers the chain: the Noise Removal (slot 0, stored on its own bypass) silences
 * the room while it really works. set_bypass sets the slot and the plugin's own bypass, as the engine does.
 */
function fakeBridge() {
  let onFrame: ((f: AudioFrame) => void) | null = null
  const status = audioStatus()
  status.slots[0] = { ...status.slots[0], params: status.slots[0].params.map((p) => (p.isBypass ? { ...p, normalized: 1 } : p)) }
  const stored = snapshot().inputs[0].entries
  const nr0 = JSON.stringify(status.slots[0].params)
  const reply = (i: number): AudioSlot => status.slots[i]
  const report: WlFlowReport = { path: 'C:/Settings.json', backupPath: 'C:/b.json', extraBackupPath: null, wasRunning: false, forced: false, restarted: false, written: true, restoredFrom: null, changes: [], hash: 'h2', steps: ['checked', 'backedUp', 'written', 'verified'] }
  const bridge: DesktopBridge = {
    engineInfo: vi.fn(async () => ({ appVersion: '2.0.0', rustVersion: null, os: 'windows', arch: 'x86_64' })),
    audioDevices: vi.fn(async () => ({ inputs: [status.input], outputs: [status.output], defaultInputId: 'in1', defaultOutputId: 'out1' })),
    audioStart: vi.fn(async (_o, cb: (f: AudioFrame) => void) => {
      onFrame = cb
      return status
    }),
    audioStop: vi.fn(async () => undefined),
    audioSetParam: vi.fn(async (slot: number, id: number, value: number) => {
      const s = status.slots[slot]
      status.slots[slot] = { ...s, params: s.params.map((p) => (p.id === id ? { ...p, normalized: Math.fround(value) } : p)) }
      return reply(slot)
    }),
    audioSetBypass: vi.fn(async (slot: number, bypassed: boolean) => {
      const s = status.slots[slot]
      status.slots[slot] = { ...s, bypassed, params: s.params.map((p) => (p.isBypass ? { ...p, normalized: bypassed ? 1 : 0 } : p)) }
      return reply(slot)
    }),
    audioLoadState: vi.fn(async (slot: number) => reply(slot)),
    audioSetMonitor: vi.fn(async () => undefined),
    audioSetGain: vi.fn(async () => undefined),
    audioStatus: vi.fn(async () => status),
    audioExportStates: vi.fn(async () =>
      status.slots
        .filter((x) => x.status.status === 'hosted')
        .map((x) => ({ index: x.index, name: x.name, filePath: x.filePath, bypassed: x.bypassed, parameterState: x.index === 0 && JSON.stringify(x.params) !== nr0 ? 'TkVX' : stored[x.index].parameterState })),
    ),
    wavelinkRead: vi.fn(async () => snapshot()),
    wavelinkPreview: vi.fn(async (changes) => changes.map((c: { index: number; inputKey: string }) => ({ inputKey: c.inputKey, input: 'Wave XLR', index: c.index, plugin: 'Elgato Noise Removal', field: 'parameterState' as const, from: 'a', to: 'b' }))),
    wavelinkExport: vi.fn(async () => report),
    wavelinkBackups: vi.fn(async () => []),
    wavelinkRestore: vi.fn(async () => report),
    renderOpen: vi.fn(async () => ({ sampleRate: 48000, latencySamples: 0, slots: status.slots })),
    renderSetParam: vi.fn(async (slot: number) => reply(slot)),
    renderSetBypass: vi.fn(async (slot: number) => reply(slot)),
    renderLoadState: vi.fn(async (slot: number) => reply(slot)),
    renderRun: vi.fn(async (x: Float32Array) => x.slice()),
    renderExportStates: vi.fn(async () => []),
    renderClose: vi.fn(async () => undefined),
  }
  let seq = 0
  /** Stream frames of `raw` through the Noise Removal as it is now. */
  const push = (raw: Float32Array[]) =>
    act(() => {
      for (const r of raw) {
        const nr = status.slots[0]
        const works = !nr.bypassed && nr.params.every((p) => !p.isBypass || p.normalized < 0.5)
        const processed = r.slice()
        if (works)
          for (let b = 0; b < FRAME; b += 480) {
            let s = 0
            for (let i = b; i < b + 480; i++) s += r[i] * r[i]
            if (10 * Math.log10(s / 480 + 1e-20) < ROOM + 3) processed.fill(0, b, b + 480)
          }
        const counters = { blocks: seq * 10, inputOverruns: 0, outputUnderruns: 0, monitorDropped: 0, streamDropped: 0, streamErrors: 0, processP50Us: 1, processP99Us: 2, processMaxUs: 3 }
        onFrame?.({ seq: seq++, sampleRate: 48000, latencySamples: 480, settled: true, latencyChanged: false, rawRmsDb: -40, rawPeakDb: -30, processedRmsDb: -40, processedPeakDb: -30, counters, raw: r, processed })
      }
    })
  return { bridge, push, status }
}

const quiet = framesOf(noise(48000 * 20, ROOM, 5))
const talk = framesOf(speech(20, ROOM))

async function started() {
  const fake = fakeBridge()
  render(
    <ThemeProvider theme={theme}>
      <DesktopScreen bridge={fake.bridge} page="live" />
    </ThemeProvider>,
  )
  const start = await screen.findByRole('button', { name: T.bar.start })
  await waitFor(() => expect(start).not.toHaveProperty('disabled', true))
  fireEvent.click(start)
  await screen.findByRole('button', { name: T.bar.stop })
  return fake
}

beforeAll(() => i18n.changeLanguage('en'))
afterEach(() => cleanup())

describe('live tuning: Calibrate noise', () => {
  it('needs the engine; suggests hearing the effects; switches the Noise Removal on, then checks the words; Save writes its state', async () => {
    const fake = fakeBridge()
    render(
      <ThemeProvider theme={theme}>
        <DesktopScreen bridge={fake.bridge} page="live" />
      </ThemeProvider>,
    )
    const card = await screen.findByTestId('tune-calibrate')
    expect(within(card).getByRole('button', { name: C.start })).toHaveProperty('disabled', true)
    expect(within(card).getByTestId('tune-calibrate-needs').textContent).toBe(C.needEngine)
    cleanup()

    const { bridge, push } = await started()
    const box = screen.getByTestId('tune-calibrate')
    fireEvent.click(within(within(box).getByTestId('tune-calibrate-hear')).getByRole('button', { name: C.hearButton }))
    await waitFor(() => expect(bridge.audioSetMonitor).toHaveBeenCalledWith('processed'))
    fireEvent.click(within(box).getByRole('button', { name: C.start }))
    expect(within(box).getByTestId('tune-calibrate-do').textContent).toBe(C.do.quiet)
    push(quiet.slice(0, 52))
    // own bypass cleared by switching it on, strength from the bottom of the ladder
    await waitFor(() => expect(bridge.audioSetBypass).toHaveBeenCalledWith(0, false))
    expect(bridge.audioSetParam).toHaveBeenCalledWith(0, VAD, 0)
    expect(within(box).getByTestId('tune-calibrate-do').textContent).toBe(C.do.quietSet)
    push(quiet.slice(52, 90))
    expect(within(box).getByTestId('tune-calibrate-do').textContent).toBe(C.do.talk)
    push(talk.slice(0, 130))
    const result = await within(box).findByTestId('tune-calibrate-result')
    expect(within(result).getByTestId('tune-calibrate-pauses').textContent).toContain(`→ ${C.result.silence}`)
    expect(result.textContent).toContain(C.result.wordsWhole)
    expect(result.textContent).toContain('Elgato Noise Removal on')
    expect(result.textContent).toContain('Elgato Noise Removal strength 85 → 0')
    // the changes are live chain entries with their own Undo
    expect(screen.getAllByTestId('tune-advice-undo')).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: T.save }))
    await waitFor(() => expect(bridge.wavelinkPreview).toHaveBeenCalled())
    expect(bridge.wavelinkPreview).toHaveBeenLastCalledWith([{ inputKey: INPUT_KEY, index: 0, parameterState: 'TkVX' }])
    fireEvent.click(await screen.findByRole('button', { name: en.desktop.save.cancel }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    fireEvent.click(within(box).getByRole('button', { name: C.undo }))
    await waitFor(() => expect(bridge.audioSetBypass).toHaveBeenLastCalledWith(0, true))
    expect(bridge.audioSetParam).toHaveBeenLastCalledWith(0, VAD, expect.closeTo(0.85, 6))
    expect(screen.queryByTestId('tune-advice-undo')).toBeNull()
    expect(within(box).getByTestId('tune-calibrate-notice').textContent).toBe(C.notice.undone)
    // about 20 s of stream through the whole live screen
  }, 30_000)

  it('stopping midway puts the chain back; stopping the engine ends it', async () => {
    const { bridge, push } = await started()
    const box = screen.getByTestId('tune-calibrate')
    fireEvent.click(within(box).getByRole('button', { name: C.start }))
    push(quiet.slice(0, 55))
    await waitFor(() => expect(bridge.audioSetBypass).toHaveBeenCalledWith(0, false))
    fireEvent.click(within(box).getByRole('button', { name: C.cancel }))
    await waitFor(() => expect(bridge.audioSetBypass).toHaveBeenLastCalledWith(0, true))
    expect(within(box).getByTestId('tune-calibrate-notice').textContent).toBe(C.notice.cancelled)

    fireEvent.click(within(box).getByRole('button', { name: C.start }))
    push(quiet.slice(0, 10))
    fireEvent.click(screen.getByRole('button', { name: T.bar.stop }))
    await screen.findByRole('button', { name: T.bar.start })
    expect(within(box).getByTestId('tune-calibrate-notice').textContent).toBe(C.notice.engineStopped)
    expect(within(box).getByRole('button', { name: C.start })).toHaveProperty('disabled', true)
  }, 15_000)
})
