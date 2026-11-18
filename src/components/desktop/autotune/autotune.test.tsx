import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import i18n from '../../../i18n'
import en from '../../../i18n/locales/en/desktop.json'
import { testFrames } from '../../../desktop/autotune/testRecording'
import { encodeWav, framesOf } from '../../../desktop/autotune/testWav'
import { desktopBridge, type DesktopBridge } from '../../../desktop/bridge'
import { INPUT_KEY, snapshot } from '../../../desktop/testChain'
import type { TuneChange, TuneInput, TuneResult, TuneStage } from '../../../desktop/tune'
import type { TuneSession } from '../../../desktop/tune/renderer'
import { testTake } from '../../../desktop/tune/testTake'
import type { AudioFrame, WlChainChange, WlFlowReport } from '../../../desktop/types'
import { theme } from '../../../theme'
import { DesktopScreen } from '../DesktopScreen'
import { installFakeAudio, type FakeAudio } from './testAudio'

const tuneMock = vi.hoisted(() => ({ fn: null as null | ((input: TuneInput) => Promise<TuneResult>) }))
vi.mock('../../../desktop/tune', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../desktop/tune')>()
  return { ...real, tune: (input: TuneInput) => (tuneMock.fn ?? real.tune)(input) }
})

const U = en.desktop.autotune.ui
const SR = 48000
const TAKE = testTake({ quietSec: 3, speechSec: 22 })

const summary = (speechDb: number, pauseDb: number, boom = 3): TuneResult['before'] => ({
  speechDb, peakDb: -8, clipped: 0, pauseDb, snrDb: speechDb - pauseDb, tone: [0, boom, 0, 0, 0, 0, 0, 0, 0], spreadDb: 9, deadSilence: 0, gateSwitches: 0, wordLossDb: 0,
  score: { level: 0, noise: 0, tone: 0, consistency: 0, damage: 0, total: 0 },
})
const CHANGE: TuneChange = {
  id: 'tune:2:wetDb', reason: 'tooQuiet', kind: 'value', slot: 2, key: 'wetDb', from: 6, to: 15, stage: 'level',
  titleMsg: { key: 'desktop.autotune.reason.level.up', params: { from: -30, db: 9, target: -21 } },
  changeMsg: { key: 'desktop.advice.change.db', params: { plugin: 'ReaComp', field: 'Wet', from: 6, to: 15 } },
  effect: { metric: 'speechDb', before: -30, after: -21 },
}
const UNMET = ['dead', 'chopped', 'silent', 'tone.noEq', 'budget'].map((k) => ({ key: `desktop.autotune.unmet.${k}`, params: { renders: 16 } }))
const resultOf = (changes: TuneChange[], goals: TuneInput['goals']): TuneResult => ({
  changes, before: summary(-30, -60), after: changes.length ? summary(-21, -70, 1) : summary(-30, -60), processed: TAKE.map((v) => v * 2), renders: 6,
  unmet: changes.length ? UNMET : [], log: [], goals, limit: 1,
})
const WL_CHANGES: WlChainChange[] = [{ inputKey: INPUT_KEY, index: 2, parameterState: 'bmV3' }]
const REPORT: WlFlowReport = { path: 'C:/Settings.json', backupPath: 'C:/b.json', extraBackupPath: null, wasRunning: true, forced: false, restarted: true, written: true, restoredFrom: null, changes: [], hash: 'h2', steps: ['checked', 'backedUp', 'closed', 'written', 'started', 'verified'] }

function fakes() {
  let onFrame: ((f: AudioFrame) => void) | null = null
  const bridge: DesktopBridge = {
    ...desktopBridge,
    engineInfo: vi.fn(async () => ({ appVersion: '2.0.0', rustVersion: null, os: 'windows', arch: 'x86_64' })),
    audioDevices: vi.fn(async () => ({ inputs: [{ id: 'in1', name: 'Wave XLR', isSystemDefault: true }], outputs: [], defaultInputId: 'in1', defaultOutputId: null })),
    audioStart: vi.fn(async (_o, cb: (f: AudioFrame) => void) => {
      onFrame = cb
      return {} as Awaited<ReturnType<DesktopBridge['audioStart']>>
    }),
    audioStop: vi.fn(async () => undefined),
    wavelinkRead: vi.fn(async () => snapshot()),
    wavelinkPreview: vi.fn(async (c: WlChainChange[]) => c.map((x) => ({ inputKey: x.inputKey, input: 'Wave XLR', index: x.index, plugin: 'ReaComp (ReaPlugs Edition)', field: 'parameterState' as const, from: 'a', to: 'b' }))),
    wavelinkExport: vi.fn(async () => REPORT),
  }
  const session: TuneSession = { chain: [], render: vi.fn(async () => TAKE), exportChanges: vi.fn(async () => WL_CHANGES), close: vi.fn(async () => undefined) }
  const open = vi.fn(async () => session)
  const push = (frames: AudioFrame[]) => act(() => frames.forEach((f) => onFrame?.(f)))
  return { bridge, session, open, push }
}

type Fakes = ReturnType<typeof fakes>
const view = (f: Fakes) =>
  render(
    <ThemeProvider theme={theme}>
      <DesktopScreen bridge={f.bridge} openSession={f.open} />
    </ThemeProvider>,
  )

async function recorded(f = fakes()) {
  view(f)
  const start = await screen.findByRole('button', { name: U.record.start })
  await waitFor(() => expect(start).not.toHaveProperty('disabled', true))
  fireEvent.click(start)
  await waitFor(() => expect(f.bridge.audioStart).toHaveBeenCalled())
  f.push(testFrames(TAKE))
  await screen.findByRole('heading', { name: U.goals.title })
  return f
}

/** Records, then tunes with `tune` answering `changes`. */
async function tuned(changes: TuneChange[] = [CHANGE]) {
  const f = await recorded()
  tuneMock.fn = vi.fn(async (input: TuneInput) => resultOf(changes, input.goals))
  fireEvent.click(screen.getByRole('button', { name: U.goals.tune }))
  await screen.findByRole('heading', { name: U.result.title })
  return f
}

let audio: FakeAudio
beforeAll(() => i18n.changeLanguage('en'))
beforeEach(() => {
  audio = installFakeAudio()
})
afterEach(() => {
  cleanup()
  audio.uninstall()
  tuneMock.fn = null
  localStorage.clear()
})

describe('step 1: record', () => {
  it('records the raw mic with the monitor off, counts down, stops by itself at 25 s and moves on', async () => {
    const f = fakes()
    view(f)
    expect(screen.getByRole('heading', { name: U.title })).toBeTruthy()
    const start = await screen.findByRole('button', { name: U.record.start })
    await waitFor(() => expect(start).not.toHaveProperty('disabled', true))
    fireEvent.click(start)
    await waitFor(() => expect(f.bridge.audioStart).toHaveBeenCalledWith({ inputId: 'in1', monitor: 'off' }, expect.any(Function)))
    const frames = testFrames(TAKE)
    f.push(frames.slice(0, 10))
    expect(screen.getByText(/Stay quiet/).textContent).toContain('2')
    f.push(frames.slice(10, 50))
    expect(screen.getByText(U.record.talk)).toBeTruthy()
    expect(screen.getByRole('button', { name: U.record.stop })).toHaveProperty('disabled', true)
    f.push(frames.slice(50, 130))
    expect(screen.getByRole('button', { name: U.record.stop })).toHaveProperty('disabled', false)
    expect(f.bridge.audioStop).not.toHaveBeenCalled()
    f.push(frames.slice(130))
    await screen.findByRole('heading', { name: U.goals.title })
    expect(f.bridge.audioStop).toHaveBeenCalledTimes(1)
  })

  it('frames lost on the way ask to record again', async () => {
    const f = fakes()
    view(f)
    const start = await screen.findByRole('button', { name: U.record.start })
    await waitFor(() => expect(start).not.toHaveProperty('disabled', true))
    fireEvent.click(start)
    await waitFor(() => expect(f.bridge.audioStart).toHaveBeenCalled())
    const frames = testFrames(TAKE)
    f.push(frames.slice(0, 40))
    f.push([{ ...frames[40], counters: { ...frames[40].counters, streamDropped: 2 } }])
    expect((await screen.findByTestId('autotune-record-problem')).textContent).toBe(U.record.problem.gap)
    expect(f.bridge.audioStop).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: U.record.again })).toBeTruthy()
  })

  it('a WAV file is decoded and checked; a short one is refused', async () => {
    const f = fakes()
    view(f)
    const input = await screen.findByTestId('autotune-wav')
    const short = new File([encodeWav(framesOf(TAKE.subarray(0, SR * 5)), { rate: SR, channels: 1, format: 1, bits: 16 })], 'short.wav')
    fireEvent.change(input, { target: { files: [short] } })
    expect((await screen.findByTestId('autotune-record-problem')).textContent).toBe(U.record.problem.tooShort)
    const good = new File([encodeWav(framesOf(TAKE), { rate: SR, channels: 1, format: 3, bits: 32 })], 'take.wav')
    fireEvent.change(input, { target: { files: [good] } })
    await screen.findByRole('heading', { name: U.goals.title })
    expect(f.bridge.audioStart).not.toHaveBeenCalled()
  })
})

describe('step 2: goals', () => {
  it('chips are remembered for the next time', async () => {
    await recorded()
    fireEvent.click(screen.getByRole('button', { name: U.goals.uses.calls }))
    fireEvent.click(screen.getByRole('button', { name: U.goals.bother.roomNoise }))
    fireEvent.click(screen.getByRole('button', { name: en.desktop.tune.sound.amounts.strong }))
    expect(JSON.parse(localStorage.getItem('vcb-autotune-goals') ?? 'null')).toEqual({ use: 'calls', style: 'natural', bothers: ['roomNoise'], amount: 'strong' })
    cleanup()
    await recorded()
    expect(screen.getByRole('button', { name: U.goals.uses.calls }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: U.goals.bother.roomNoise }).getAttribute('aria-pressed')).toBe('true')
  })
})

describe('step 3: tuning', () => {
  it('shows each stage as done / pass n of m / waiting, then lands on the results', async () => {
    const f = await recorded()
    let finish: () => void = () => undefined
    tuneMock.fn = vi.fn(async (input: TuneInput) => {
      const steps: [TuneStage, number][] = [['baseline', 1], ['level', 2], ['level', 3], ['noise', 4]]
      for (const [s, n] of steps) input.onProgress?.(s, n, 16)
      await new Promise<void>((r) => (finish = r))
      return resultOf([CHANGE], input.goals)
    })
    fireEvent.click(screen.getByRole('button', { name: U.goals.tune }))
    await waitFor(() => expect(screen.getByTestId('autotune-stage-noise').textContent).toContain('Pass 1 of 4'))
    expect(f.open).toHaveBeenCalledWith(f.bridge, expect.any(Float32Array))
    expect((f.open.mock.calls[0] as unknown[])[1]).toHaveLength(25 * SR)
    expect(screen.getByTestId('autotune-stage-level').textContent).toContain(U.tuning.done)
    expect(screen.getByTestId('autotune-stage-tone').textContent).toContain(U.tuning.waiting)
    await act(async () => finish())
    await screen.findByRole('heading', { name: U.result.title })
  })

  it('Cancel closes the session and goes back to the goals', async () => {
    const f = await recorded()
    tuneMock.fn = vi.fn(() => new Promise<TuneResult>(() => undefined))
    fireEvent.click(screen.getByRole('button', { name: U.goals.tune }))
    fireEvent.click(await screen.findByRole('button', { name: U.tuning.cancel }))
    await screen.findByRole('heading', { name: U.goals.title })
    await waitFor(() => expect(f.session.close).toHaveBeenCalled())
  })

  it('an engine error is said in plain words; Try again opens the session again', async () => {
    const f = await recorded()
    f.open.mockRejectedValueOnce({ code: 'chain', message: 'x' })
    tuneMock.fn = vi.fn(async (input: TuneInput) => resultOf([], input.goals))
    fireEvent.click(screen.getByRole('button', { name: U.goals.tune }))
    expect((await screen.findByTestId('autotune-tune-error')).textContent).toContain(en.desktop.errors.chain)
    fireEvent.click(screen.getByRole('button', { name: U.tuning.retry }))
    await screen.findByRole('heading', { name: U.result.title })
    expect(f.open).toHaveBeenCalledTimes(2)
  })
})

describe('step 4: listen and save', () => {
  it('lists the changes with their reasons, the metrics and up to 4 unmet goals', async () => {
    await tuned()
    expect(screen.getByTestId('autotune-metric-speech').textContent).toContain(U.result.metrics.better)
    expect(screen.getByTestId('autotune-metric-band-1')).toBeTruthy()
    const changes = screen.getByTestId('autotune-changes')
    expect(within(changes).getByText('1 change, each with its reason')).toBeTruthy()
    expect(within(changes).getByText('ReaComp Wet 6 → 15 dB')).toBeTruthy()
    const unmet = screen.getByTestId('autotune-unmet')
    expect(within(unmet).getAllByRole('listitem')).toHaveLength(4)
    fireEvent.click(within(unmet).getByRole('button', { name: 'Show all (5)' }))
    expect(within(unmet).getAllByRole('listitem')).toHaveLength(5)
  })

  it('A/B plays one side at a time and switches at the same position', async () => {
    await tuned()
    fireEvent.click(screen.getByRole('button', { name: U.result.play }))
    expect(audio.sources).toHaveLength(1)
    expect(audio.sources[0].start).toHaveBeenCalledWith(0, 0)
    const after = audio.sources[0].buffer
    audio.ctx().currentTime = 4.5
    fireEvent.click(screen.getByRole('button', { name: U.result.before }))
    expect(audio.sources[0].stop).toHaveBeenCalled()
    expect(audio.sources[1].start).toHaveBeenCalledWith(0, 4.5)
    expect(audio.sources[1].buffer).not.toBe(after)
    audio.ctx().currentTime = 6
    fireEvent.click(screen.getByRole('button', { name: U.result.pause }))
    expect(audio.sources[1].stop).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: U.result.after }))
    expect(audio.sources).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: U.result.play }))
    expect(audio.sources[2].start).toHaveBeenCalledWith(0, 6)
    expect(audio.sources[2].buffer).toBe(after)
  })

  it('Not right, adjust → retune from the result on the same take and session', async () => {
    const f = await tuned()
    fireEvent.click(screen.getByRole('button', { name: U.result.adjust }))
    const panel = screen.getByTestId('autotune-adjust')
    fireEvent.click(within(panel).getByRole('button', { name: U.goals.bother.boomy }))
    fireEvent.click(within(panel).getByRole('button', { name: U.result.retune }))
    await screen.findByRole('heading', { name: U.result.title })
    const calls = (tuneMock.fn as ReturnType<typeof vi.fn>).mock.calls as [TuneInput][]
    expect(calls).toHaveLength(2)
    expect(calls[1][0].goals.bothers).toEqual(['boomy'])
    expect(calls[1][0].start).toEqual([CHANGE])
    expect(calls[1][0].take).toBe(calls[0][0].take)
    expect(f.open).toHaveBeenCalledTimes(1)
  })

  it('Save to Wave Link exports what the session says, then offers Fine-tune live', async () => {
    const f = await tuned()
    fireEvent.click(screen.getByRole('button', { name: U.result.save }))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByTestId('tune-save-lines')
    expect(f.session.exportChanges).toHaveBeenCalledWith([CHANGE])
    expect(f.bridge.wavelinkPreview).toHaveBeenCalledWith(WL_CHANGES)
    fireEvent.click(within(dialog).getByRole('button', { name: en.desktop.save.confirm }))
    await within(dialog).findByText(en.desktop.save.done)
    expect(f.bridge.wavelinkExport).toHaveBeenCalledWith(WL_CHANGES, 'h1', false)
    fireEvent.click(within(dialog).getByRole('button', { name: en.desktop.save.close }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const saved = screen.getByTestId('autotune-saved')
    expect(within(saved).getByRole('link', { name: U.result.fineTune }).getAttribute('href')).toBe('#/desktop/live')
  })

  it('no changes: says the sound already meets the goals, nothing to save', async () => {
    await tuned([])
    expect(screen.getByTestId('autotune-none').textContent).toBe(U.result.none)
    expect(screen.getByRole('button', { name: U.result.save })).toHaveProperty('disabled', true)
    expect(screen.queryByTestId('autotune-changes')).toBeNull()
  })

  it('Record again closes the session and starts over', async () => {
    const f = await tuned()
    fireEvent.click(screen.getByRole('button', { name: U.result.again }))
    await screen.findByRole('button', { name: U.record.start })
    expect(f.session.close).toHaveBeenCalled()
  })
})
