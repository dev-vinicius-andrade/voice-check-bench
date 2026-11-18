import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import i18n from '../../../i18n'
import en from '../../../i18n/locales/en/desktop.json'
import pt from '../../../i18n/locales/pt-BR/desktop.json'
import type { ChainSlot, Change } from '../../../desktop/advice/types'
import type { FitRemoverInput, FitRemoverResult, NoiseCutAmount, NoiseCutPlan } from '../../../desktop/autotune/noiseCut'
import { testFrames } from '../../../desktop/autotune/testRecording'
import { desktopBridge, type DesktopBridge } from '../../../desktop/bridge'
import { chainOf } from '../../../desktop/slots'
import type { NoiseRegion, Stretch, VoiceNoise } from '../../../desktop/spectrum/voiceNoise'
import { engineSlots, entries, FIR, INPUT_KEY, snapshot } from '../../../desktop/testChain'
import type { TuneChange, TuneInput, TuneResult } from '../../../desktop/tune'
import type { TuneSession } from '../../../desktop/tune/renderer'
import { testTake } from '../../../desktop/tune/testTake'
import type { AudioFrame, WlChainChange, WlChainEntry, WlFlowReport } from '../../../desktop/types'
import { theme } from '../../../theme'
import { DesktopScreen } from '../DesktopScreen'
import { installFakeAudio, type FakeAudio } from './testAudio'
import { useTuneRun } from './useTuneRun'

// the tuner, the noise-cut plan, the take's analysis and the voice / noise measure are other modules' jobs: fakes
const h = vi.hoisted(() => ({
  tune: null as null | ((input: TuneInput) => Promise<TuneResult>),
  plan: null as null | ((take: Float32Array, chain: readonly ChainSlot[], entries: readonly WlChainEntry[], amount: NoiseCutAmount) => NoiseCutPlan),
  fit: null as null | ((input: FitRemoverInput) => Promise<FitRemoverResult>),
  stretches: [] as Stretch[],
}))
vi.mock('../../../desktop/tune', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../desktop/tune')>()
  return { ...real, tune: (input: TuneInput) => (h.tune ?? real.tune)(input) }
})
vi.mock('../../../desktop/autotune/noiseCut', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../desktop/autotune/noiseCut')>()
  return {
    ...real,
    planNoiseCut: (...a: Parameters<typeof real.planNoiseCut>) => (h.plan ?? real.planNoiseCut)(...a),
    fitRemover: (input: FitRemoverInput) => (h.fit ?? real.fitRemover)(input),
  }
})
vi.mock('../../../desktop/spectrum/take', async () => {
  const { SPECTRUM_POINTS: n } = await import('../../../desktop/spectrum/types')
  return {
    createTakeAnalyzer: () => {
      const spectrum = { freqsHz: new Float32Array(n), rawDb: new Float32Array(n).fill(-80), processedDb: new Float32Array(n).fill(-60), tones: [] }
      return { push: () => undefined, reset: () => undefined, seek: () => undefined, read: () => spectrum }
    },
  }
})
vi.mock('../../../desktop/autotune/manualEq', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../desktop/autotune/manualEq')>()
  return { ...real, remeasured: (_take: Float32Array, result: TuneResult, processed: Float32Array): TuneResult => ({ ...result, processed }) }
})
vi.mock('../../../desktop/spectrum/voiceNoise', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../desktop/spectrum/voiceNoise')>()
  const { SPECTRUM_POINTS: n } = await import('../../../desktop/spectrum/types')
  const region = (id: NoiseRegion['id']): NoiseRegion => ({ id, loHz: 0, hiHz: 0, noiseDb: -60, underVoiceDb: 30 })
  const vn: VoiceNoise = {
    freqsHz: new Float32Array(n), voiceDb: new Float32Array(n).fill(-30), noiseDb: new Float32Array(n).fill(-90), voiceLevelDb: -21, noiseLevelDb: -60,
    regions: [region('low'), region('mid'), region('high')],
  }
  return {
    ...real,
    noiseStretches: () => h.stretches,
    voiceNoiseOf: (_a: Float32Array, _t: Float32Array, stretches: readonly Stretch[]) => (stretches.length ? vn : null),
    noiseOnly: (_a: Float32Array, stretches: readonly Stretch[]) => new Float32Array(stretches.length ? 48000 : 0).fill(0.1),
  }
})

const U = en.desktop.autotune.ui
const N = U.noiseCut
const TAKE = testTake({ quietSec: 3, speechSec: 22 })
const PROCESSED = new Float32Array(TAKE.length).fill(0.1875)
const EQ = 2
const REAFIR = 5
const summary = (speechDb: number): TuneResult['before'] => ({
  speechDb, peakDb: -8, clipped: 0, pauseDb: -70, snrDb: speechDb + 70, tone: [0, 0, 0, 0, 0, 0, 0, 0, 0], spreadDb: 9, deadSilence: 0, gateSwitches: 0, wordLossDb: 0, cutSpeech: 0, cutEvents: 0, pumpDb: 0, burstDb: NaN, burstEvents: 0, removerCut: NaN, removerCutEvents: NaN,
  score: { level: 0, noise: 0, tone: 0, consistency: 0, damage: 0, total: 0 },
})
const CHANGE: TuneChange = {
  id: 'tune:3:wetDb', reason: 'tooQuiet', kind: 'value', slot: 3, key: 'wetDb', from: 2, to: 8, stage: 'level',
  titleMsg: { key: 'desktop.autotune.reason.level.up', params: { from: -30, db: 9, target: -21 } },
  changeMsg: { key: 'desktop.advice.change.db', params: { plugin: 'ReaComp', field: 'Wet', from: 2, to: 8 } },
  effect: { metric: 'speechDb', before: -30, after: -21 },
}
const resultOf = (changes: TuneChange[], goals: TuneInput['goals']): TuneResult => ({ changes, before: summary(-30), after: summary(-21), processed: PROCESSED, renders: 6, unmet: [], log: [], goals, limit: 1 })
const NOTE = { key: 'desktop.autotune.ui.noiseCut.notes.noBand', params: { hz: 3150 } }
/** A whistle cut on ReaEQ band 1 (gain, frequency, width), and ReaFIR's state by amount. */
const planOf = (amount: NoiseCutAmount): NoiseCutPlan => ({
  reafir: { slot: REAFIR, state: `fir-${amount}` },
  remover: null,
  edits: [{ slot: EQ, key: 'band1.gainDb', to: -18 }, { slot: EQ, key: 'band1.freqHz', to: 3150 }, { slot: EQ, key: 'band1.bwOct', to: 0.1 }],
  notes: [NOTE],
})
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
    wavelinkPreview: vi.fn(async (c: WlChainChange[]) => c.map((x) => ({ inputKey: x.inputKey, input: 'Wave XLR', index: x.index, plugin: FIR, field: 'parameterState' as const, from: 'a', to: 'b' }))),
    wavelinkExport: vi.fn(async () => REPORT),
  }
  const session: TuneSession = {
    chain: chainOf(engineSlots(), entries()),
    render: vi.fn(async () => PROCESSED),
    exportChanges: vi.fn(async () => [{ inputKey: INPUT_KEY, index: REAFIR, parameterState: 'Zmly' }]),
    setState: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  }
  return { bridge, session, open: vi.fn(async () => session), push: (frames: AudioFrame[]) => act(() => frames.forEach((f) => onFrame?.(f))) }
}
type Fakes = ReturnType<typeof fakes>

async function record(f: Fakes): Promise<void> {
  const start = await screen.findByRole('button', { name: U.record.start })
  await waitFor(() => expect(start).not.toHaveProperty('disabled', true))
  fireEvent.click(start)
  await waitFor(() => expect(f.bridge.audioStart).toHaveBeenCalled())
  f.push(testFrames(TAKE))
  await screen.findByRole('heading', { name: U.goals.title })
}

async function tuned(changes: TuneChange[] = [CHANGE]) {
  const f = fakes()
  render(
    <ThemeProvider theme={theme}>
      <DesktopScreen bridge={f.bridge} openSession={f.open} />
    </ThemeProvider>,
  )
  await record(f)
  h.tune = vi.fn(async (input: TuneInput) => resultOf(changes, input.goals))
  fireEvent.click(screen.getByRole('button', { name: U.goals.tune }))
  await screen.findByTestId('noise-cut')
  return f
}

const tunes = () => vi.mocked(h.tune as NonNullable<typeof h.tune>).mock.calls.map(([input]) => input)
const lastRender = (f: Fakes): readonly Change[] => vi.mocked(f.session.render).mock.calls.at(-1)?.[0] ?? []
const manual = (slot: number, key: string, to: number) => expect.objectContaining({ id: `manual:${slot}:${key}`, slot, key, to })
const cutButton = () => screen.getByTestId('noise-cut-button')
const amountButton = (name: string) => within(screen.getByRole('group', { name: N.amount.label })).getByRole('button', { name })
/** Clicks Cut the noise and waits for the take to be tuned again (`n` tunes in all). */
async function cutAndWait(n = 2): Promise<void> {
  fireEvent.click(cutButton())
  await waitFor(() => expect(h.tune).toHaveBeenCalledTimes(n))
  await screen.findByTestId('noise-cut-applied')
}

let audio: FakeAudio
beforeAll(async () => {
  await i18n.changeLanguage('en')
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})
beforeEach(() => {
  audio = installFakeAudio()
  h.stretches = [{ from: 0, to: 144000 }]
  h.plan = vi.fn((_t: Float32Array, _c: readonly ChainSlot[], _e: readonly WlChainEntry[], amount: NoiseCutAmount) => planOf(amount))
})
afterEach(async () => {
  cleanup()
  audio.uninstall()
  h.tune = null
  h.plan = null
  h.fit = null
  localStorage.clear()
  await i18n.changeLanguage('en')
})

// the first render of the screen is slow when the whole suite runs at once
vi.setConfig({ testTimeout: 20000 })

describe('result step: Cut the noise', () => {
  it('shows under "In your noise" with Normal picked; nothing without noise stretches', async () => {
    await tuned()
    const box = screen.getByTestId('noise-cut')
    expect(within(box).getByText(N.help)).toBeTruthy()
    expect(cutButton().textContent).toBe(N.cut)
    expect(amountButton(N.amount.normal).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByTestId('noise-cut-strong')).toBeNull()
    fireEvent.click(amountButton(N.amount.strong))
    expect(screen.getByTestId('noise-cut-strong').textContent).toBe(N.strongWarning)
    cleanup()
    h.stretches = []
    const f = fakes()
    render(
      <ThemeProvider theme={theme}>
        <DesktopScreen bridge={f.bridge} openSession={f.open} />
      </ThemeProvider>,
    )
    await record(f)
    fireEvent.click(screen.getByRole('button', { name: U.goals.tune }))
    await screen.findByTestId('take-spectrum')
    expect(screen.queryByTestId('noise-cut')).toBeNull()
  })

  it('loads ReaFIR first, adds the edits in one go, tunes the take again (tuning shown) and keeps the edits on the new result', async () => {
    const f = await tuned()
    let release: (() => void) | null = null
    h.tune = vi.fn(async (input: TuneInput) => {
      if (vi.mocked(h.tune as NonNullable<typeof h.tune>).mock.calls.length > 0) await new Promise<void>((r) => (release = r))
      return resultOf([CHANGE], input.goals)
    })
    fireEvent.click(cutButton())
    await waitFor(() => expect(f.session.setState).toHaveBeenCalledWith(REAFIR, 'fir-normal'))
    // planned on the take, on the chain as it is, with the input's Wave Link entries
    const [take, chain, given, amount] = vi.mocked(h.plan as NonNullable<typeof h.plan>).mock.calls[0]
    expect(take.length).toBe(TAKE.length)
    expect(chain.find((s) => s.index === EQ)?.values['band1.gainDb']).toBe(0)
    expect(given.map((e) => e.index)).toEqual([0, 1, 2, 3, 4, 5])
    expect(amount).toBe('normal')
    // the run goes back to tuning
    await screen.findByRole('heading', { name: U.tuning.title })
    await act(async () => release?.())
    await screen.findByTestId('noise-cut-applied')
    expect(screen.getByTestId('noise-cut-applied').textContent).toContain('Noise cut applied (Normal).')
    // the same goals, from the untouched chain (no start, no old render)
    const again = tunes()[0]
    expect(again.start).toBeUndefined()
    expect(again.startRender).toBeUndefined()
    await waitFor(() => expect(lastRender(f)).toEqual([CHANGE, manual(EQ, 'band1.gainDb', -18), manual(EQ, 'band1.freqHz', 3150), manual(EQ, 'band1.bwOct', 0.1)]))
    expect(screen.getByTestId('take-spectrum-mine')).toBeTruthy()
    expect(screen.getByTestId('noise-cut-notes').textContent).toBe('No free ReaEQ band for the whistle at 3,150 Hz: set one band\'s gain to 0 to use it.')
    expect(screen.queryByTestId('noise-cut-button')).toBeNull()
  })

  it('a new amount while applied replaces ReaFIR\'s state, plans on the chain without the cut and keeps the edits', async () => {
    const f = await tuned()
    await cutAndWait()
    fireEvent.click(amountButton(N.amount.strong))
    await waitFor(() => expect(f.session.setState).toHaveBeenLastCalledWith(REAFIR, 'fir-strong'))
    await waitFor(() => expect(h.tune).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(screen.getByTestId('noise-cut-applied').textContent).toContain('(Strong)'))
    const calls = vi.mocked(h.plan as NonNullable<typeof h.plan>).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[1][1].find((s) => s.index === EQ)?.values['band1.gainDb']).toBe(0)
    expect(calls[1][3]).toBe('strong')
    expect(vi.mocked(f.session.setState).mock.calls).toEqual([[REAFIR, 'fir-normal'], [REAFIR, 'fir-strong']])
    expect(screen.getByTestId('noise-cut-strong')).toBeTruthy()
    await waitFor(() => expect(lastRender(f)).toEqual([CHANGE, manual(EQ, 'band1.gainDb', -18), manual(EQ, 'band1.freqHz', 3150), manual(EQ, 'band1.bwOct', 0.1)]))
  })

  it('Undo puts ReaFIR\'s own state back, takes off only the cut\'s edits and tunes again; hand changes since stay', async () => {
    const f = await tuned()
    await cutAndWait()
    // by hand after the cut: a cut value (band 1's gain) and another band
    fireEvent.keyDown(screen.getByTestId('spectrum-band-1'), { key: 'ArrowUp' })
    fireEvent.keyDown(screen.getByTestId('spectrum-band-2'), { key: 'ArrowUp' })
    await waitFor(() => expect(lastRender(f)).toContainEqual(manual(EQ, 'band2.gainDb', -1.5)))
    expect(lastRender(f)).toContainEqual(manual(EQ, 'band1.gainDb', -17.5))
    fireEvent.click(within(screen.getByTestId('noise-cut-applied')).getByRole('button', { name: N.undo }))
    await waitFor(() => expect(f.session.setState).toHaveBeenLastCalledWith(REAFIR, null))
    await waitFor(() => expect(h.tune).toHaveBeenCalledTimes(3))
    await screen.findByTestId('noise-cut-button')
    expect(screen.queryByTestId('noise-cut-applied')).toBeNull()
    expect(screen.queryByTestId('noise-cut-notes')).toBeNull()
    await waitFor(() => expect(lastRender(f)).toEqual([CHANGE, manual(EQ, 'band1.gainDb', -17.5), manual(EQ, 'band2.gainDb', -1.5)]))
  })

  it('a refused ReaFIR state shows the error, adds no edit and does not tune again', async () => {
    const f = await tuned()
    vi.mocked(f.session.setState).mockRejectedValueOnce(new Error('ReaFIR refused the state'))
    fireEvent.click(cutButton())
    await screen.findByTestId('noise-cut-error')
    expect(screen.getByTestId('noise-cut-error').textContent).toBe('Something went wrong: ReaFIR refused the state')
    // put back as it was
    expect(f.session.setState).toHaveBeenLastCalledWith(REAFIR, null)
    expect(h.tune).toHaveBeenCalledTimes(1)
    expect(f.session.render).not.toHaveBeenCalled()
    expect(screen.queryByTestId('noise-cut-applied')).toBeNull()
    expect(screen.queryByTestId('take-spectrum-mine')).toBeNull()
    expect(cutButton()).toHaveProperty('disabled', false)
  })

  it('nothing to cut: the button says so and the notes say why; nothing is loaded or tuned', async () => {
    h.plan = vi.fn(() => ({ reafir: null, remover: null, edits: [], notes: [{ key: 'desktop.autotune.ui.noiseCut.notes.noReaFir' }] }))
    const f = await tuned()
    fireEvent.click(cutButton())
    await waitFor(() => expect(cutButton().textContent).toBe(N.nothing))
    expect(cutButton()).toHaveProperty('disabled', true)
    expect(screen.getByTestId('noise-cut-notes').textContent).toBe(N.notes.noReaFir)
    expect(f.session.setState).not.toHaveBeenCalled()
    expect(h.tune).toHaveBeenCalledTimes(1)
  })

  it('Save is on with only a noise cut and its preview names ReaFIR\'s noise profile', async () => {
    h.plan = vi.fn((_t: Float32Array, _c: readonly ChainSlot[], _e: readonly WlChainEntry[], amount: NoiseCutAmount) => ({ ...planOf(amount), edits: [], notes: [] }))
    const f = await tuned([])
    expect(screen.getByRole('button', { name: U.result.save })).toHaveProperty('disabled', true)
    await cutAndWait()
    const save = screen.getByRole('button', { name: U.result.save })
    expect(save).toHaveProperty('disabled', false)
    fireEvent.click(save)
    await waitFor(() => expect(f.session.exportChanges).toHaveBeenCalledWith([]))
    const lines = await screen.findByTestId('tune-save-lines')
    expect(lines.textContent).toBe('ReaFIR: noise profile from your recording')
  })

  it('Record again clears the cut', async () => {
    const f = await tuned()
    await cutAndWait()
    fireEvent.click(amountButton(N.amount.strong))
    await waitFor(() => expect(h.tune).toHaveBeenCalledTimes(3))
    await screen.findByTestId('noise-cut-applied')
    fireEvent.click(screen.getByRole('button', { name: U.result.again }))
    await record(f)
    fireEvent.click(screen.getByRole('button', { name: U.goals.tune }))
    await screen.findByTestId('noise-cut')
    expect(screen.queryByTestId('noise-cut-applied')).toBeNull()
    expect(screen.queryByTestId('take-spectrum-mine')).toBeNull()
    expect(amountButton(N.amount.normal).getAttribute('aria-pressed')).toBe('true')
  })
})

describe('result step: Cut the noise with Noise Removal', () => {
  const NR_SLOT = 0
  /** The chain's Noise Removal (strength 85 in the test chain) as the remover, with the whistle cut. */
  const removerPlan = (amount: NoiseCutAmount): NoiseCutPlan => ({ ...planOf(amount), reafir: null, remover: { slot: NR_SLOT, key: 'strength', from: 85 }, notes: [] })
  const fitted = (to: number | null, note: FitRemoverResult['note'] = null): FitRemoverResult => ({ edit: to === null ? null : { slot: NR_SLOT, key: 'strength', to }, note, renders: 3, steps: [] })
  const WHISTLE = [manual(EQ, 'band1.gainDb', -18), manual(EQ, 'band1.freqHz', 3150), manual(EQ, 'band1.bwOct', 0.1)]
  beforeEach(() => {
    h.plan = vi.fn((_t: Float32Array, _c: readonly ChainSlot[], _e: readonly WlChainEntry[], amount: NoiseCutAmount) => removerPlan(amount))
  })

  it('fits the strength through the session (progress shown), loads no state, does not tune again; the edits carry the strength', async () => {
    const f = await tuned()
    let release: (() => void) | null = null
    h.fit = vi.fn(async (input: FitRemoverInput) => {
      input.onStep?.(90)
      await input.render([])
      await new Promise<void>((r) => (release = r))
      return fitted(95)
    })
    fireEvent.click(cutButton())
    const trying = await screen.findByTestId('noise-cut-trying')
    expect(trying.textContent).toBe('Trying Noise Removal at 90…')
    expect(amountButton(N.amount.normal)).toHaveProperty('disabled', true)
    const input = vi.mocked(h.fit as NonNullable<typeof h.fit>).mock.calls[0][0]
    // the whistle cut is on the edits the fit renders with; the strength is the fit's to set
    expect(input.edits).toEqual(WHISTLE)
    expect(input.remover).toEqual({ slot: NR_SLOT, key: 'strength', from: 85 })
    expect(input.amount).toBe('normal')
    expect(input.result.changes).toEqual([CHANGE])
    expect(input.tuned.find((s) => s.index === NR_SLOT)?.values.strength).toBe(85)
    // it renders through the session, before any edit is handed to the hand-edit queue
    expect(f.session.render).toHaveBeenCalledWith([])
    expect(screen.queryByTestId('take-spectrum-mine')).toBeNull()
    await act(async () => release?.())
    await screen.findByTestId('noise-cut-applied')
    expect(screen.queryByTestId('noise-cut-trying')).toBeNull()
    await waitFor(() => expect(lastRender(f)).toEqual([CHANGE, ...WHISTLE, manual(NR_SLOT, 'strength', 95)]))
    expect(f.session.setState).not.toHaveBeenCalled()
    expect(h.tune).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('take-spectrum-mine').textContent).toContain('strength 85 → 95')
    expect(screen.queryByTestId('noise-cut-notes')).toBeNull()
  })

  it('Undo takes the strength off with the cut\'s edits (hand changes since stay), loads no state and does not tune again', async () => {
    const f = await tuned()
    h.fit = vi.fn(async () => fitted(95))
    fireEvent.click(cutButton())
    await screen.findByTestId('noise-cut-applied')
    fireEvent.keyDown(screen.getByTestId('spectrum-band-2'), { key: 'ArrowUp' })
    await waitFor(() => expect(lastRender(f)).toEqual([CHANGE, ...WHISTLE, manual(NR_SLOT, 'strength', 95), manual(EQ, 'band2.gainDb', -1.5)]))
    fireEvent.click(within(screen.getByTestId('noise-cut-applied')).getByRole('button', { name: N.undo }))
    await screen.findByTestId('noise-cut-button')
    await waitFor(() => expect(lastRender(f)).toEqual([CHANGE, manual(EQ, 'band2.gainDb', -1.5)]))
    expect(f.session.setState).not.toHaveBeenCalled()
    expect(h.tune).toHaveBeenCalledTimes(1)
  })

  it('another amount fits again from the strength without the cut; the fit\'s note shows', async () => {
    const f = await tuned()
    h.fit = vi.fn(async (input: FitRemoverInput) => (input.amount === 'strong' ? fitted(90, { key: 'desktop.autotune.ui.noiseCut.notes.removerLimit' }) : fitted(95)))
    fireEvent.click(cutButton())
    await screen.findByTestId('noise-cut-applied')
    fireEvent.click(amountButton(N.amount.strong))
    await waitFor(() => expect(screen.getByTestId('noise-cut-applied').textContent).toContain('(Strong)'))
    const calls = vi.mocked(h.fit as NonNullable<typeof h.fit>).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[1][0].edits).toEqual(WHISTLE)
    expect(vi.mocked(h.plan as NonNullable<typeof h.plan>).mock.calls[1][1].find((s) => s.index === NR_SLOT)?.values.strength).toBe(85)
    await waitFor(() => expect(lastRender(f)).toEqual([CHANGE, ...WHISTLE, manual(NR_SLOT, 'strength', 90)]))
    expect(screen.getByTestId('noise-cut-notes').textContent).toBe(N.notes.removerLimit)
    expect(f.session.setState).not.toHaveBeenCalled()
    expect(h.tune).toHaveBeenCalledTimes(1)
  })

  it('no whistle and a fit that does not help: nothing to cut, with the note', async () => {
    h.plan = vi.fn((_t: Float32Array, _c: readonly ChainSlot[], _e: readonly WlChainEntry[], amount: NoiseCutAmount) => ({ ...removerPlan(amount), edits: [] }))
    h.fit = vi.fn(async () => fitted(null, { key: 'desktop.autotune.ui.noiseCut.notes.removerNoHelp' }))
    const f = await tuned()
    fireEvent.click(cutButton())
    await waitFor(() => expect(cutButton().textContent).toBe(N.nothing))
    expect(screen.getByTestId('noise-cut-notes').textContent).toBe(N.notes.removerNoHelp)
    expect(screen.queryByTestId('noise-cut-applied')).toBeNull()
    expect(f.session.setState).not.toHaveBeenCalled()
  })

  it('a failed render while fitting shows the error and adds no edit', async () => {
    const f = await tuned()
    h.fit = vi.fn(async () => Promise.reject(new Error('render failed')))
    fireEvent.click(cutButton())
    await screen.findByTestId('noise-cut-error')
    expect(screen.queryByTestId('noise-cut-applied')).toBeNull()
    expect(screen.queryByTestId('take-spectrum-mine')).toBeNull()
    expect(f.session.setState).not.toHaveBeenCalled()
    expect(cutButton()).toHaveProperty('disabled', false)
  })
})

describe('useTuneRun after a plugin state change', () => {
  const setup = () => {
    const f = fakes()
    h.tune = vi.fn(async (input: TuneInput) => resultOf([CHANGE], input.goals))
    const hook = renderHook(() => useTuneRun(f.bridge, f.open))
    return { f, hook }
  }
  const goals = { style: 'natural', amount: 'normal', bothers: [] } as unknown as TuneInput['goals']

  it('Adjust starts from the previous render when no state changed since', async () => {
    const { hook } = setup()
    await act(() => hook.result.current.run(TAKE, goals))
    await act(() => hook.result.current.adjust('tooProcessed'))
    await act(() => hook.result.current.adjust([]))
    expect(tunes()[2].startRender).toBe(PROCESSED)
  })

  it('Adjust does not reuse the render of a result made before a state was loaded or restored', async () => {
    const { f, hook } = setup()
    await act(() => hook.result.current.run(TAKE, goals))
    await act(() => hook.result.current.setState(REAFIR, 'fir'))
    expect(f.session.setState).toHaveBeenCalledWith(REAFIR, 'fir')
    await act(() => hook.result.current.adjust([]))
    expect(tunes()[1].start).toEqual([CHANGE])
    expect(tunes()[1].startRender).toBeUndefined()
    // the result after it was rendered with the new state: its render may start the next run
    await act(() => hook.result.current.adjust([]))
    expect(tunes()[2].startRender).toBe(PROCESSED)
  })

  it('rerun tunes again from the untouched chain with the result\'s goals and limit; setState rejects without a session', async () => {
    const { hook } = setup()
    await expect(hook.result.current.setState(REAFIR, null)).rejects.toThrow('no tune session')
    await act(() => hook.result.current.run(TAKE, goals))
    await act(() => hook.result.current.rerun())
    expect(tunes()[1]).toMatchObject({ take: TAKE, goals, limit: 1 })
    expect(tunes()[1].start).toBeUndefined()
  })
})

describe('Cut the noise strings', () => {
  it('en and pt-BR', async () => {
    const p = pt.desktop.autotune.ui.noiseCut
    expect(Object.keys(p)).toEqual(Object.keys(N))
    expect(p.cut).toBe('Cortar o ruído')
    expect(N.cut).toBe('Cut the noise')
    expect([p.amount.light, p.amount.normal, p.amount.strong]).toEqual(['Leve', 'Normal', 'Forte'])
    expect([N.amount.light, N.amount.normal, N.amount.strong]).toEqual(['Light', 'Normal', 'Strong'])
    expect(p.applied).toBe('Corte de ruído aplicado ({{amount}}).')
    expect(p.undo).toBe('Desfazer')
    expect(p.strongWarning).toBe('Forte pode deixar a voz com som aguado.')
    expect(N.strongWarning).toBe('Strong can make the voice sound watery.')
    expect(p.help).toBe('Tira o ruído medido aqui: os apitos constantes com cortes estreitos no EQ, e o resto com o seu removedor de ruído, subindo aos poucos enquanto sua voz é conferida.')
    expect(N.help).toBe('Takes the noise measured here out: steady whistles with narrow EQ cuts, and the rest with your noise remover, raised step by step while your voice is checked.')
    expect(N.notes.removerLimit).toBe('Noise Removal was raised as far as your voice allows; some noise is still there.')
    expect(p.notes.removerLimit).toBe('O Noise Removal subiu até onde sua voz permite; ainda sobra um pouco de ruído.')
    expect(N.notes.removerNoHelp).toBe('A stronger Noise Removal did not lower the noise in this recording.')
    expect(p.notes.removerNoHelp).toBe('Um Noise Removal mais forte não baixou o ruído nesta gravação.')
    expect(i18n.t('desktop.autotune.ui.noiseCut.trying', { strength: 80 })).toBe('Trying Noise Removal at 80…')
    expect(p.notes.noReaFir).toBe('Não há ReaFIR ligado nos seus efeitos, então o chiado não foi mexido.')
    expect(p.notes.reaFirUnknown).toBe('As configurações do seu ReaFIR estão num formato que este app não conhece, então ficaram como estão.')
    expect(N.notes.reaFirUnknown).toBe('Your ReaFIR settings are in a form this app does not know, so they were left as they are.')
    expect(pt.desktop.save.noiseProfile).toBe('{{plugin}}: perfil de ruído da sua gravação')
    await i18n.changeLanguage('pt-BR')
    expect(i18n.t('desktop.autotune.ui.noiseCut.notes.noBand', NOTE.params)).toBe('Sem banda livre no ReaEQ para o apito em 3.150 Hz: deixe o ganho de uma banda em 0 para usá-la.')
    expect(i18n.t('desktop.autotune.ui.noiseCut.applied', { amount: p.amount.normal })).toBe('Corte de ruído aplicado (Normal).')
    expect(i18n.t('desktop.autotune.ui.noiseCut.trying', { strength: 80 })).toBe('Testando o Noise Removal em 80…')
  })
})
