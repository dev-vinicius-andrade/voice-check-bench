import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import i18n from '../../../../i18n'
import en from '../../../../i18n/locales/en/desktop.json'
import pt from '../../../../i18n/locales/pt-BR/desktop.json'
import type { ChainSlot } from '../../../../desktop/advice/types'
import { testFrames } from '../../../../desktop/autotune/testRecording'
import { desktopBridge, type DesktopBridge } from '../../../../desktop/bridge'
import { chainOf } from '../../../../desktop/slots'
import type { NotchPlan, SpectrumTone } from '../../../../desktop/spectrum'
import { engineSlots, entries, INPUT_KEY, snapshot } from '../../../../desktop/testChain'
import type { TuneChange, TuneInput, TuneResult } from '../../../../desktop/tune'
import type { TuneSession } from '../../../../desktop/tune/renderer'
import { testTake } from '../../../../desktop/tune/testTake'
import type { AudioFrame, WlChainChange, WlFlowReport } from '../../../../desktop/types'
import { theme } from '../../../../theme'
import { DesktopScreen } from '../../DesktopScreen'
import { installFakeAudio, type FakeAudio } from '../testAudio'

// the tuner, the take's analysis and the re-measure are other modules' jobs: fakes the test drives
const h = vi.hoisted(() => ({
  tune: null as null | ((input: TuneInput) => Promise<TuneResult>),
  tones: [] as SpectrumTone[],
  plan: null as NotchPlan | null,
  made: [] as { raw: Float32Array; processed: Float32Array }[],
  seeks: [] as (number | null)[],
  remeasured: [] as Float32Array[],
  unmet: [] as TuneResult['unmet'],
}))
vi.mock('../../../../desktop/tune', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../../desktop/tune')>()
  return { ...real, tune: (input: TuneInput) => (h.tune ?? real.tune)(input) }
})
vi.mock('../../../../desktop/spectrum/take', async () => {
  const { SPECTRUM_POINTS: n } = await import('../../../../desktop/spectrum/types')
  return {
    createTakeAnalyzer: (raw: Float32Array, processed: Float32Array) => {
      h.made.push({ raw, processed })
      return {
        push: () => undefined,
        reset: () => undefined,
        seek: (s: number | null) => void h.seeks.push(s),
        read: () => ({ freqsHz: new Float32Array(n), rawDb: new Float32Array(n).fill(-80), processedDb: new Float32Array(n).fill(-60), tones: h.tones }),
      }
    },
  }
})
vi.mock('../../../../desktop/spectrum', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../../desktop/spectrum')>()
  return { ...real, notchPlan: () => h.plan }
})
vi.mock('../../../../desktop/autotune/manualEq', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../../desktop/autotune/manualEq')>()
  return {
    ...real,
    // what is heard measured again: the voice level of the render's first sample, so the table shows which render it is
    remeasured: (_take: Float32Array, result: TuneResult, processed: Float32Array): TuneResult => {
      h.remeasured.push(processed)
      return { ...result, processed, after: { ...result.after, speechDb: Math.round(processed[0] * -100) } }
    },
  }
})

const U = en.desktop.autotune.ui
const P = U.spectrum
const T = en.desktop.tune.spectrum
const TAKE = testTake({ quietSec: 3, speechSec: 22 })
const CHAIN: ChainSlot[] = chainOf(engineSlots(), entries())
const EQ = 2
const summary = (speechDb: number): TuneResult['before'] => ({
  speechDb, peakDb: -8, clipped: 0, pauseDb: -70, snrDb: speechDb + 70, tone: [0, 0, 0, 0, 0, 0, 0, 0, 0], spreadDb: 9, deadSilence: 0, gateSwitches: 0, wordLossDb: 0, cutSpeech: 0, cutEvents: 0, pumpDb: 0, burstDb: NaN, burstEvents: 0, removerCut: NaN, removerCutEvents: NaN,
  score: { level: 0, noise: 0, tone: 0, consistency: 0, damage: 0, total: 0 },
})
const change = (to: number): TuneChange => ({
  id: 'tune:3:wetDb', reason: 'tooQuiet', kind: 'value', slot: 3, key: 'wetDb', from: 2, to, stage: 'level',
  titleMsg: { key: 'desktop.autotune.reason.level.up', params: { from: -30, db: 9, target: -21 } },
  changeMsg: { key: 'desktop.advice.change.db', params: { plugin: 'ReaComp', field: 'Wet', from: 2, to } },
  effect: { metric: 'speechDb', before: -30, after: -21 },
})
const CHANGE = change(8)
const PROCESSED = new Float32Array(TAKE.length).fill(0.1875)
const resultOf = (changes: TuneChange[], goals: TuneInput['goals']): TuneResult => ({
  changes, before: summary(-30), after: summary(-21), processed: PROCESSED, renders: 6, unmet: h.unmet, log: [], goals, limit: 1,
})
const rendered = (v: number): Float32Array => new Float32Array(TAKE.length).fill(v)
const TONE: SpectrumTone = { freqHz: 923.4, levelDb: -48, overDb: 30.2, inRaw: true, inProcessed: true }
const PLAN: NotchPlan = { n: 2, freqHz: 923, gainDb: -18, bwOct: 0.1, enable: false }
const WL: WlChainChange[] = [{ inputKey: INPUT_KEY, index: 3, parameterState: 'bmV3' }]
const REPORT: WlFlowReport = { path: 'C:/Settings.json', backupPath: 'C:/b.json', extraBackupPath: null, wasRunning: true, forced: false, restarted: true, written: true, restoredFrom: null, changes: [], hash: 'h2', steps: ['checked', 'backedUp', 'closed', 'written', 'started', 'verified'] }

/** A render the test finishes by hand. */
interface Pending {
  changes: readonly unknown[]
  done(x: Float32Array): Promise<void>
  fail(e: unknown): Promise<void>
}

function fakes(chain: ChainSlot[] = CHAIN) {
  let onFrame: ((f: AudioFrame) => void) | null = null
  const renders: Pending[] = []
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
  const session: TuneSession = {
    chain,
    render: vi.fn(
      (changes) =>
        new Promise<Float32Array>((resolve, reject) => {
          renders.push({ changes, done: (x) => act(async () => resolve(x)), fail: (e) => act(async () => reject(e)) })
        }),
    ),
    exportChanges: vi.fn(async () => WL),
    close: vi.fn(async () => undefined),
  }
  const open = vi.fn(async () => session)
  const push = (frames: AudioFrame[]) => act(() => frames.forEach((f) => onFrame?.(f)))
  return { bridge, session, open, push, renders }
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

/** Records and tunes (the tuner answers `changes`), then waits for the result step. */
async function tuned(changes: TuneChange[] = [CHANGE], f = fakes()) {
  render(
    <ThemeProvider theme={theme}>
      <DesktopScreen bridge={f.bridge} openSession={f.open} />
    </ThemeProvider>,
  )
  await record(f)
  h.tune = vi.fn(async (input: TuneInput) => resultOf(changes, input.goals))
  fireEvent.click(screen.getByRole('button', { name: U.goals.tune }))
  await screen.findByTestId('take-spectrum')
  return f
}

const band = (n: number) => screen.getByTestId(`spectrum-band-${n}`)
const key = (n: number, k: string) => fireEvent.keyDown(band(n), { key: k })
const speechRow = () => screen.getByTestId('autotune-metric-speech').textContent ?? ''
const edit = (key: string, to: number) => expect.objectContaining({ id: `manual:${EQ}:${key}`, kind: 'value', slot: EQ, key, to })
/** Plays After and returns the first sample of what it plays. */
const playedAfter = (): number => {
  fireEvent.click(screen.getByRole('button', { name: U.result.play }))
  const src = audio.sources.at(-1)
  fireEvent.click(screen.getByRole('button', { name: U.result.pause }))
  return (src?.buffer as unknown as { data: Float32Array }).data[0]
}

let audio: FakeAudio
beforeAll(async () => {
  await i18n.changeLanguage('en')
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})
beforeEach(() => {
  audio = installFakeAudio()
  h.tones = []
  h.plan = PLAN
  h.made = []
  h.seeks = []
  h.remeasured = []
  h.unmet = []
})
afterEach(() => {
  cleanup()
  audio.uninstall()
  h.tune = null
  localStorage.clear()
})

// the first render of the screen is slow when the whole suite runs at once
vi.setConfig({ testTimeout: 20000 })

describe('result step: spectrum of the take', () => {
  it('shows the take and its render, the ReaEQ bands and the whole-take tones (no "listening")', async () => {
    h.tones = [TONE]
    await tuned()
    const card = screen.getByTestId('take-spectrum')
    expect(within(card).getByRole('heading', { name: P.title })).toBeTruthy()
    expect(within(card).getByText(P.help)).toBeTruthy()
    expect(within(card).getByRole('group', { name: P.aria })).toBeTruthy()
    expect(h.made.at(-1)?.raw).toHaveLength(TAKE.length)
    expect(h.made.at(-1)?.processed).toBe(PROCESSED)
    expect(band(2).getAttribute('aria-label')).toBe('Band 2, 3500 Hz, -2.0 dB')
    expect(within(card).getByTestId('spectrum-tone').textContent).toContain('Steady tone at 923 Hz · 30 dB over its surroundings')
    expect(within(card).queryByText(T.tones.listening)).toBeNull()
    expect(within(card).queryByTestId('take-spectrum-mine')).toBeNull()
  })

  it('follows the player: the whole take when stopped, the position while it plays or stands paused', async () => {
    await tuned()
    vi.useFakeTimers()
    try {
      expect(h.seeks.at(-1)).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: U.result.play }))
      audio.ctx().currentTime = 4.5
      act(() => void vi.advanceTimersByTime(100))
      expect(h.seeks.at(-1)).toBe(4.5)
      fireEvent.click(screen.getByRole('button', { name: U.result.pause }))
      expect(h.seeks.at(-1)).toBe(4.5)
      fireEvent.click(screen.getByRole('button', { name: U.result.stop }))
      expect(h.seeks.at(-1)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('without a ReaEQ switched on: no curve, no handles, a hint', async () => {
    const off: TuneChange = { ...CHANGE, id: 'tune:2:on', kind: 'switch', slot: EQ, on: false } as TuneChange
    await tuned([off])
    expect(screen.getByTestId('take-spectrum-no-eq').textContent).toBe(P.noEq)
    expect(screen.queryByTestId('spectrum-band-1')).toBeNull()
    expect(screen.queryByTestId('spectrum-eq-curve')).toBeNull()
  })
})

describe('result step: hand edits render the take', () => {
  it('a drag only moves the handle; letting go renders the tuner’s changes plus the edit, then After and the table follow', async () => {
    const f = await tuned()
    const before = speechRow()
    const b = band(2)
    fireEvent.pointerDown(b, { clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(b, { clientX: 300, clientY: 200, pointerId: 1 })
    expect(f.session.render).not.toHaveBeenCalled()
    expect(band(2).getAttribute('aria-label')).not.toBe('Band 2, 3500 Hz, -2.0 dB')
    fireEvent.pointerUp(b, { clientX: 300, clientY: 200, pointerId: 1 })
    await waitFor(() => expect(f.session.render).toHaveBeenCalledTimes(1))
    expect(f.renders[0].changes).toEqual([CHANGE, edit('band2.freqHz', expect.any(Number)), edit('band2.gainDb', expect.any(Number))])
    expect(screen.getByTestId('take-spectrum-rendering').textContent).toBe(P.rendering)
    expect(within(screen.getByTestId('take-spectrum-mine')).getAllByRole('listitem')).toHaveLength(1)
    await f.renders[0].done(rendered(0.25))
    await waitFor(() => expect(screen.queryByTestId('take-spectrum-rendering')).toBeNull())
    expect(speechRow()).not.toBe(before)
    expect(speechRow()).toContain('25')
    expect(playedAfter()).toBe(0.25)
    expect(h.made.at(-1)?.processed[0]).toBe(0.25)
  })

  it('renders one at a time: while one runs only the latest edit waits, and a stale render is never shown', async () => {
    const f = await tuned()
    key(2, 'ArrowUp') // −1.5
    await waitFor(() => expect(f.session.render).toHaveBeenCalledTimes(1))
    key(2, 'ArrowUp') // −1.0, waits
    key(2, 'ArrowUp') // −0.5, replaces it
    expect(f.session.render).toHaveBeenCalledTimes(1)
    await f.renders[0].done(rendered(0.3125))
    await waitFor(() => expect(f.session.render).toHaveBeenCalledTimes(2))
    expect(f.renders[1].changes).toEqual([CHANGE, edit('band2.gainDb', -0.5)])
    expect(h.remeasured).toHaveLength(0)
    expect(playedAfter()).toBe(0.1875)
    await f.renders[1].done(rendered(0.375))
    await waitFor(() => expect(h.remeasured).toHaveLength(1))
    expect(f.session.render).toHaveBeenCalledTimes(2)
    expect(playedAfter()).toBe(0.375)
  })

  it('a render that fails says so plainly and keeps the previous audio', async () => {
    const f = await tuned()
    key(2, 'ArrowUp')
    await waitFor(() => expect(f.session.render).toHaveBeenCalledTimes(1))
    await f.renders[0].done(rendered(0.4375))
    key(2, 'ArrowUp')
    await waitFor(() => expect(f.session.render).toHaveBeenCalledTimes(2))
    await f.renders[1].fail({ code: 'chain', message: 'x' })
    expect((await screen.findByTestId('take-spectrum-error')).textContent).toBe(en.desktop.errors.chain)
    expect(screen.queryByTestId('take-spectrum-rendering')).toBeNull()
    expect(playedAfter()).toBe(0.4375)
  })

  it('Cut sets the notch as hand edits in one render; Undo puts back exactly what those keys had', async () => {
    h.tones = [TONE]
    const f = await tuned()
    key(2, 'ArrowUp') // gain −1.5 by hand first
    await waitFor(() => expect(f.session.render).toHaveBeenCalledTimes(1))
    await f.renders[0].done(rendered(0.3125))
    fireEvent.click(screen.getByRole('button', { name: T.tones.cutAria.replace('{{hz}}', '923 Hz') }))
    await waitFor(() => expect(f.session.render).toHaveBeenCalledTimes(2))
    expect(f.renders[1].changes).toEqual([CHANGE, edit('band2.gainDb', -18), edit('band2.freqHz', 923), edit('band2.bwOct', 0.1)])
    expect(screen.getByTestId('spectrum-tone').textContent).toContain('Cut with band 2')
    expect(band(2).getAttribute('aria-label')).toBe('Band 2, 923 Hz, -18.0 dB')
    await f.renders[1].done(rendered(0.34375))
    fireEvent.click(screen.getByRole('button', { name: T.tones.undoAria.replace('{{hz}}', '923 Hz') }))
    await waitFor(() => expect(f.session.render).toHaveBeenCalledTimes(3))
    expect(f.renders[2].changes).toEqual([CHANGE, edit('band2.gainDb', -1.5)])
    expect(band(2).getAttribute('aria-label')).toBe('Band 2, 3500 Hz, -1.5 dB')
    expect(screen.getByRole('button', { name: T.tones.cutAria.replace('{{hz}}', '923 Hz') })).toBeTruthy()
  })

  it('"Undo my changes" brings the tuner’s own result back without a render', async () => {
    const f = await tuned()
    const before = speechRow()
    key(2, 'ArrowUp')
    await waitFor(() => expect(f.session.render).toHaveBeenCalledTimes(1))
    await f.renders[0].done(rendered(0.25))
    await waitFor(() => expect(speechRow()).not.toBe(before))
    fireEvent.click(screen.getByRole('button', { name: P.mine.undo }))
    expect(screen.queryByTestId('take-spectrum-mine')).toBeNull()
    expect(speechRow()).toBe(before)
    expect(band(2).getAttribute('aria-label')).toBe('Band 2, 3500 Hz, -2.0 dB')
    expect(playedAfter()).toBe(0.1875)
    expect(f.session.render).toHaveBeenCalledTimes(1)
  })
})

describe('result step: hand edits with Adjust, Record again and Save', () => {
  it('Adjust keeps the edits: applied again on the new result in one render', async () => {
    const f = await tuned()
    key(2, 'ArrowUp')
    await waitFor(() => expect(f.session.render).toHaveBeenCalledTimes(1))
    await f.renders[0].done(rendered(0.25))
    const next = change(10)
    h.tune = vi.fn(async (input: TuneInput) => resultOf([next], input.goals))
    fireEvent.click(screen.getByRole('button', { name: U.result.adjust }))
    const panel = screen.getByTestId('autotune-adjust')
    fireEvent.click(within(panel).getByRole('button', { name: U.goals.bother.boomy }))
    fireEvent.click(within(panel).getByRole('button', { name: U.result.retune }))
    await screen.findByTestId('take-spectrum')
    await waitFor(() => expect(f.session.render).toHaveBeenCalledTimes(2))
    expect(f.renders[1].changes).toEqual([next, edit('band2.gainDb', -1.5)])
    expect(screen.getByTestId('take-spectrum-mine')).toBeTruthy()
    await f.renders[1].done(rendered(0.28125))
    await waitFor(() => expect(speechRow()).toContain('28'))
    expect(f.session.render).toHaveBeenCalledTimes(2)
  })

  it('Record again clears the edits', async () => {
    const f = await tuned()
    key(2, 'ArrowUp')
    await waitFor(() => expect(f.session.render).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: U.result.again }))
    await record(f)
    fireEvent.click(screen.getByRole('button', { name: U.goals.tune }))
    await screen.findByTestId('take-spectrum')
    expect(screen.queryByTestId('take-spectrum-mine')).toBeNull()
    expect(band(2).getAttribute('aria-label')).toBe('Band 2, 3500 Hz, -2.0 dB')
    expect(f.session.render).toHaveBeenCalledTimes(1)
  })

  it('Save writes the tuner’s changes with the edits; an edit clears "Saved"; edits alone can be saved', async () => {
    const f = await tuned([])
    expect(screen.getByRole('button', { name: U.result.save })).toHaveProperty('disabled', true)
    key(2, 'ArrowUp')
    await waitFor(() => expect(f.session.render).toHaveBeenCalledTimes(1))
    await f.renders[0].done(rendered(0.25))
    const save = screen.getByRole('button', { name: U.result.save })
    expect(save).toHaveProperty('disabled', false)
    fireEvent.click(save)
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByTestId('tune-save-lines')
    const sent = vi.mocked(f.session.exportChanges).mock.calls[0][0]
    expect(sent).toEqual([edit('band2.gainDb', -1.5)])
    fireEvent.click(within(dialog).getByRole('button', { name: en.desktop.save.confirm }))
    await within(dialog).findByText(en.desktop.save.done)
    fireEvent.click(within(dialog).getByRole('button', { name: en.desktop.save.close }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByTestId('autotune-saved')).toBeTruthy()
    expect(screen.getByRole('button', { name: U.result.save })).toHaveProperty('disabled', true)
    key(2, 'ArrowUp')
    expect(screen.queryByTestId('autotune-saved')).toBeNull()
    // no Save while the take is being rendered with the new edit (the session is busy)
    expect(screen.getByRole('button', { name: U.result.save })).toHaveProperty('disabled', true)
    await waitFor(() => expect(f.session.render).toHaveBeenCalledTimes(2))
    await f.renders[1].done(rendered(0.3))
    expect(screen.getByRole('button', { name: U.result.save })).toHaveProperty('disabled', false)
  })

  it('Save of a result with tuner changes sends them with the edits after', async () => {
    const f = await tuned()
    key(2, 'ArrowDown')
    await waitFor(() => expect(f.session.render).toHaveBeenCalledTimes(1))
    await f.renders[0].done(rendered(0.25))
    fireEvent.click(screen.getByRole('button', { name: U.result.save }))
    await waitFor(() => expect(f.session.exportChanges).toHaveBeenCalledWith([CHANGE, edit('band2.gainDb', -2.5)]))
  })
})

/** A tuner change of the ReaEQ's Band 2 (slot 2): `key` from → to, with `also` values moved with it. */
const eqChange = (key: string, from: number, to: number, also: TuneChange['also'] = undefined): TuneChange => ({
  id: `tune:${EQ}:${key}`, reason: 'tone', kind: 'value', slot: EQ, key, from, to, stage: 'tone', also,
  titleMsg: { key: 'desktop.autotune.reason.level.up', params: { from: -30, db: 9, target: -21 } },
  changeMsg: { key: 'desktop.advice.change.db', params: { plugin: 'ReaEQ', field: `Band 2 ${key}`, from, to } },
  effect: { metric: 'speechDb', before: -30, after: -21 },
})
const changeItems = () => within(screen.getByTestId('autotune-changes')).getAllByRole('listitem', { hidden: true })

describe('result step: what the tuner did, after a hand edit', () => {
  it('a tuner change whose value was then set by hand is struck through with a note; the others are not', async () => {
    const gain = eqChange('band2.gainDb', -2, -4)
    const f = await tuned([CHANGE, gain])
    expect(screen.queryByTestId('autotune-change-overridden')).toBeNull()
    key(2, 'ArrowUp') // band 2 gain −4 → −3.5 by hand
    await waitFor(() => expect(f.session.render).toHaveBeenCalledTimes(1))
    await f.renders[0].done(rendered(0.25))
    const [comp, eq] = changeItems()
    expect(within(comp).queryByTestId('autotune-change-overridden')).toBeNull()
    const line = within(eq).getByTestId('autotune-change-overridden')
    expect(line.querySelector('s')?.textContent).toBe('ReaEQ Band 2 band2.gainDb -2 → -4 dB')
    expect(line.textContent).toContain(P.changedByYou)
    // Undo my changes: the tuner's line stands again
    fireEvent.click(screen.getByRole('button', { name: P.mine.undo }))
    expect(screen.queryByTestId('autotune-change-overridden')).toBeNull()
  })

  it('a hand edit of one of a change’s `also` values strikes that change too', async () => {
    const also = [{ id: `tune:${EQ}:band2.gainDb`, reason: 'tone' as const, titleMsg: { key: 'desktop.advice.undo' }, kind: 'value' as const, slot: EQ, key: 'band2.gainDb', from: -2, to: -4 }]
    const moved = eqChange('band2.freqHz', 3500, 500, also)
    const f = await tuned([moved])
    key(2, 'ArrowUp') // the gain, an `also` value of the change
    await waitFor(() => expect(f.session.render).toHaveBeenCalledTimes(1))
    expect(within(changeItems()[0]).getByTestId('autotune-change-overridden').textContent).toContain(P.changedByYou)
  })

  it('"What it could not do" says it was measured before the hand edits, only when there are edits', async () => {
    h.unmet = [{ key: 'desktop.autotune.unmet.budget', params: { renders: 16 } }]
    const f = await tuned()
    const unmet = () => screen.getByTestId('autotune-unmet')
    expect(within(unmet()).queryByTestId('autotune-unmet-before-edits')).toBeNull()
    key(2, 'ArrowUp')
    await waitFor(() => expect(f.session.render).toHaveBeenCalledTimes(1))
    await f.renders[0].done(rendered(0.25))
    expect(within(unmet()).getByTestId('autotune-unmet-before-edits').textContent).toBe(P.measuredBefore)
    fireEvent.click(screen.getByRole('button', { name: P.mine.undo }))
    expect(within(unmet()).queryByTestId('autotune-unmet-before-edits')).toBeNull()
  })

  it('no unmet goals: no box and no caption, edits or not', async () => {
    const f = await tuned()
    key(2, 'ArrowUp')
    await waitFor(() => expect(f.session.render).toHaveBeenCalledTimes(1))
    expect(screen.queryByTestId('autotune-unmet')).toBeNull()
    expect(screen.queryByTestId('autotune-unmet-before-edits')).toBeNull()
  })
})

describe('result step spectrum strings', () => {
  it('every en string has its pt-BR twin', () => {
    const flat = (o: object, p = ''): [string, string][] =>
      Object.entries(o).flatMap(([k, v]) => (typeof v === 'string' ? [[`${p}${k}`, v] as [string, string]] : flat(v as object, `${p}${k}.`)))
    const e = flat(en.desktop.autotune.ui.spectrum)
    const b = new Map(flat(pt.desktop.autotune.ui.spectrum))
    expect(e.length).toBeGreaterThan(5)
    for (const [k, v] of e) {
      expect(b.get(k), k).toBeTruthy()
      expect(v).toBeTruthy()
    }
    expect(pt.desktop.autotune.ui.spectrum.title).toBe('Espectro')
    expect(pt.desktop.autotune.ui.spectrum.mine.undo).toBe('Desfazer minhas mudanças')
    expect(pt.desktop.autotune.ui.spectrum.noEq).toContain('ReaEQ')
    expect(pt.desktop.autotune.ui.spectrum.changedByYou).toBe('mudado por você depois')
    expect(pt.desktop.autotune.ui.spectrum.measuredBefore).toBe('Medido antes das suas mudanças.')
  })
})
