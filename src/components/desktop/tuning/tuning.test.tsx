import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import i18n from '../../../i18n'
import en from '../../../i18n/locales/en/desktop.json'
import type { DesktopBridge } from '../../../desktop/bridge'
import { audioStatus, INPUT_KEY, snapshot } from '../../../desktop/testChain'
import { noiseFrames, voiceFrames } from '../../../desktop/testFrames'
import type { AudioFrame, AudioSlot, WlFlowReport } from '../../../desktop/types'
import { theme } from '../../../theme'
import { db2a } from '../../../wavelink/fxp'
import { DesktopScreen } from '../DesktopScreen'

const T = en.desktop
const REPORT: WlFlowReport = {
  path: 'C:/Settings.json',
  backupPath: 'C:/Settings.before-2026-11-10.json',
  extraBackupPath: null,
  wasRunning: true,
  forced: true,
  restarted: true,
  written: true,
  restoredFrom: null,
  changes: [],
  hash: 'h2',
  steps: ['checked', 'backedUp', 'closed', 'forced', 'written', 'started', 'verified'],
}

/** A bridge without Tauri: records calls, the stream is pushed by the test. */
function fakeBridge(dryAmp = 0) {
  let onFrame: ((f: AudioFrame) => void) | null = null
  const status = audioStatus(dryAmp)
  const slotReply = (index: number): AudioSlot => status.slots[index]
  let nrState = snapshot(dryAmp).inputs[0].entries[0].parameterState
  const bridge: DesktopBridge = {
    engineInfo: vi.fn(async () => ({ appVersion: '2.0.0', rustVersion: 'rustc 1.99.1', os: 'windows', arch: 'x86_64' })),
    audioDevices: vi.fn(async () => ({
      inputs: [status.input, { id: 'in2', name: 'USB Mic', isSystemDefault: false }],
      outputs: [status.output],
      defaultInputId: 'in1',
      defaultOutputId: 'out1',
    })),
    audioStart: vi.fn(async (_opts, cb: (f: AudioFrame) => void) => {
      onFrame = cb
      return status
    }),
    audioStop: vi.fn(async () => undefined),
    audioSetParam: vi.fn(async (slot: number, id: number, value: number) => {
      if (slot === 0) nrState = 'TlIy' // Noise Removal saves a new state
      const s = status.slots[slot]
      status.slots[slot] = { ...s, params: s.params.map((p) => (p.id === id ? { ...p, normalized: Math.fround(value) } : p)) }
      return slotReply(slot)
    }),
    audioSetBypass: vi.fn(async (slot: number, bypassed: boolean) => {
      status.slots[slot] = { ...status.slots[slot], bypassed }
      return slotReply(slot)
    }),
    audioLoadState: vi.fn(async (slot: number) => slotReply(slot)),
    audioSetMonitor: vi.fn(async () => undefined),
    audioSetGain: vi.fn(async () => undefined),
    audioStatus: vi.fn(async () => status),
    audioExportStates: vi.fn(async () =>
      status.slots
        .filter((x) => x.status.status === 'hosted')
        .map((x) => ({ index: x.index, name: x.name, filePath: x.filePath, bypassed: x.bypassed, parameterState: x.index === 0 ? nrState : snapshot(dryAmp).inputs[0].entries[x.index].parameterState })),
    ),
    wavelinkRead: vi.fn(async () => snapshot(dryAmp)),
    wavelinkPreview: vi.fn(async (changes) =>
      changes.map((c: { index: number; inputKey: string }) => ({ inputKey: c.inputKey, input: 'Wave XLR', index: c.index, plugin: 'ReaGate (ReaPlugs Edition)', field: 'parameterState' as const, from: 'changed (288 bytes)', to: 'changed (288 bytes)' })),
    ),
    wavelinkExport: vi.fn(async () => REPORT),
    wavelinkBackups: vi.fn(async () => [
      { path: 'C:/b2.json', name: 'Settings.before-2.json', modifiedMs: 2e12, size: 10 },
      { path: 'C:/b1.json', name: 'Settings.before-1.json', modifiedMs: 1e12, size: 10 },
    ]),
    wavelinkRestore: vi.fn(async () => ({ ...REPORT, forced: false, restoredFrom: 'C:/b1.json' })),
  }
  const push = (frames: AudioFrame[]) => act(() => frames.forEach((f) => onFrame?.(f)))
  return { bridge, push }
}

const view = (bridge: DesktopBridge) =>
  render(
    <ThemeProvider theme={theme}>
      <DesktopScreen bridge={bridge} />
    </ThemeProvider>,
  )

async function started(dryAmp = 0) {
  const fake = fakeBridge(dryAmp)
  view(fake.bridge)
  const start = await screen.findByRole('button', { name: T.tune.bar.start })
  await waitFor(() => expect(start).not.toHaveProperty('disabled', true))
  fireEvent.click(start)
  await screen.findByRole('button', { name: T.tune.bar.stop })
  await screen.findByTestId('tune-effect-1')
  return fake
}

beforeAll(() => i18n.changeLanguage('en'))
afterEach(cleanup)

describe('live tuning: start and stop', () => {
  it('starts on the picked devices with the monitor off, shows the delay and the chain; stops', async () => {
    const { bridge } = await started()
    expect(bridge.audioStart).toHaveBeenCalledWith({ inputId: 'in1', outputId: 'out1' }, expect.any(Function))
    expect(screen.getByRole('button', { name: T.tune.hear.off }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('tune-monitor-alert').textContent).toContain('Delay right now: 10 ms.')
    expect(within(screen.getByTestId('tune-effect-4')).getByText(/Can't preview, kept as is/)).toBeTruthy()
    expect(within(screen.getByTestId('tune-effect-1')).getByRole('button', { name: T.tune.effects.pluginWindow })).toHaveProperty('disabled', true)
    expect(screen.getByTestId('engine-footer').textContent).toContain('rustc 1.99.1')
    fireEvent.click(screen.getByRole('button', { name: T.tune.hear.raw }))
    await waitFor(() => expect(bridge.audioSetMonitor).toHaveBeenCalledWith('raw'))
    fireEvent.click(screen.getByRole('button', { name: T.tune.bar.stop }))
    await screen.findByRole('button', { name: T.tune.bar.start })
    expect(bridge.audioStop).toHaveBeenCalled()
  })

  it('shows an engine error as a plain alert', async () => {
    const { bridge } = fakeBridge()
    bridge.audioStart = vi.fn(async () => Promise.reject({ code: 'noDevice', message: 'none' }))
    view(bridge)
    const start = await screen.findByRole('button', { name: T.tune.bar.start })
    await waitFor(() => expect(start).not.toHaveProperty('disabled', true))
    fireEvent.click(start)
    expect((await screen.findByTestId('tune-error')).textContent).toContain(T.errors.noDevice)
  })
})

describe('live tuning: metrics', () => {
  it('frames fill the metric cards; in a pause the speech values are held', async () => {
    const { push } = await started()
    push(voiceFrames(6, 2))
    expect(screen.getByTestId('tune-level-value').textContent).toMatch(/dBFS/)
    expect(screen.getByTestId('tune-level').textContent).toContain('Mic alone')
    expect(screen.queryByTestId('tune-held')).toBeNull()
    push(noiseFrames(5, 60))
    expect(screen.getByTestId('tune-held').textContent).toMatch(/Last heard \d+ s ago/)
    expect(screen.getAllByTestId('tune-segment-row')).toHaveLength(1)
  })
})

describe('live tuning: changes', () => {
  it('Try this applies a change live and Undo reverts it; both are markers and segments', async () => {
    const { bridge, push } = await started(1)
    push(voiceFrames(6, 2))
    const row = screen.getByText('ReaGate Dry 0 → -20 dB').closest('li')!
    fireEvent.click(within(row as HTMLElement).getByRole('button', { name: T.tune.try.apply }))
    await waitFor(() => expect(bridge.audioSetParam).toHaveBeenCalledWith(1, 9, expect.closeTo(db2a(-20), 6)))
    const undoRow = screen.getByTestId('tune-advice-undo')
    expect(undoRow.textContent).toContain('ReaGate Dry 0 → -20 dB')
    fireEvent.click(within(undoRow).getByRole('button', { name: T.tune.try.undo }))
    await waitFor(() => expect(bridge.audioSetParam).toHaveBeenLastCalledWith(1, 9, expect.closeTo(1, 6)))
    expect(screen.queryByTestId('tune-advice-undo')).toBeNull()
    push(voiceFrames(1, 2, 5))
    expect(screen.getAllByTestId('tune-chart-marker')).toHaveLength(2)
    expect(screen.getAllByTestId('tune-segment-row')).toHaveLength(3)
  })

  it('Undo after the same value was moved by hand is a conflict', async () => {
    const { push } = await started(1)
    push(voiceFrames(6, 2))
    const row = screen.getByText('ReaGate Dry 0 → -20 dB').closest('li') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: T.tune.try.apply }))
    const dry = within(screen.getByTestId('tune-effect-1')).getByRole('slider', { name: 'Dry' })
    fireEvent.change(dry, { target: { value: -30 } })
    fireEvent.click(within(screen.getByTestId('tune-advice-undo')).getByRole('button', { name: T.tune.try.undo }))
    expect(screen.getByTestId('tune-notice').textContent).toContain(en.desktop.advice.conflict)
  })

  it('a slider sends the normalized value of its unit', async () => {
    const { bridge } = await started()
    const card = screen.getByTestId('tune-effect-1')
    fireEvent.click(within(card).getByRole('button', { name: /Show the settings/ }))
    fireEvent.change(within(card).getByRole('slider', { name: 'Threshold' }), { target: { value: -52 } })
    await waitFor(() => expect(bridge.audioSetParam).toHaveBeenCalledWith(1, 0, expect.closeTo(db2a(-52), 9)))
    fireEvent.click(within(card).getByRole('switch'))
    await waitFor(() => expect(bridge.audioSetBypass).toHaveBeenCalledWith(1, true))
    const nr = screen.getByTestId('tune-effect-0')
    fireEvent.click(within(nr).getByRole('button', { name: /Show the settings/ }))
    fireEvent.change(within(nr).getByRole('slider', { name: T.tune.effects.strength }), { target: { value: 40 } })
    await waitFor(() => expect(bridge.audioSetParam).toHaveBeenCalledWith(0, 1163972580, 0.4))
  })
})

describe('live tuning: Wave Link', () => {
  it('Save shows the diff, asks again when Wave Link does not close, forces, and shows the verify result', async () => {
    const { bridge } = await started()
    const card = screen.getByTestId('tune-effect-1')
    fireEvent.click(within(card).getByRole('button', { name: /Show the settings/ }))
    fireEvent.change(within(card).getByRole('slider', { name: 'Dry' }), { target: { value: -20 } })
    const nr = screen.getByTestId('tune-effect-0')
    fireEvent.click(within(nr).getByRole('button', { name: /Show the settings/ }))
    fireEvent.change(within(nr).getByRole('slider', { name: T.tune.effects.strength }), { target: { value: 60 } })
    fireEvent.click(within(nr).getByRole('switch'))
    await waitFor(() => expect(bridge.audioSetBypass).toHaveBeenCalledWith(0, true))
    vi.mocked(bridge.wavelinkExport).mockRejectedValueOnce({ code: 'closeTimeout', message: 'still running' })
    fireEvent.click(screen.getByRole('button', { name: T.tune.save }))
    const dialog = await screen.findByRole('dialog')
    expect((await within(dialog).findByTestId('tune-save-lines')).textContent).toContain('ReaGate Dry (dB): -inf → -20')
    expect(vi.mocked(bridge.wavelinkPreview).mock.calls[0][0]).toEqual([
      { inputKey: INPUT_KEY, index: 0, parameterState: 'TlIy', bypassed: true },
      expect.objectContaining({ index: 1, parameterState: expect.any(String) }),
    ])
    expect(within(dialog).queryByTestId('tune-save-unsaved')).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: T.save.confirm }))
    expect(await within(dialog).findByText(T.save.force)).toBeTruthy()
    expect(bridge.wavelinkExport).toHaveBeenLastCalledWith(expect.any(Array), 'h1', false)
    fireEvent.click(within(dialog).getByRole('button', { name: T.save.forceConfirm }))
    expect(await within(dialog).findByText(T.save.done)).toBeTruthy()
    expect(bridge.wavelinkExport).toHaveBeenLastCalledWith(expect.any(Array), 'h1', true)
    expect(within(dialog).getByText(T.save.forced)).toBeTruthy()
    await waitFor(() => expect(bridge.wavelinkRead).toHaveBeenCalledTimes(2))
  })

  it('Restore lists the backups, writes the picked one back and reports it', async () => {
    const { bridge } = await started()
    fireEvent.click(screen.getByRole('button', { name: T.tune.restore }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(await within(dialog).findByLabelText(/Settings.before-1.json/))
    fireEvent.click(within(dialog).getByRole('button', { name: T.restore.confirm }))
    expect(await within(dialog).findByText(T.restore.done)).toBeTruthy()
    expect(bridge.wavelinkRestore).toHaveBeenCalledWith('C:/b1.json', false)
    expect(within(dialog).getByText(T.restore.restartPreview)).toBeTruthy()
  })
})
