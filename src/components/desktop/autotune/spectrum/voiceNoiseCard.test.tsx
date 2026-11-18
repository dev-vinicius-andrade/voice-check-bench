import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { createElement, type ComponentProps } from 'react'
import i18n from '../../../../i18n'
import en from '../../../../i18n/locales/en/desktop.json'
import pt from '../../../../i18n/locales/pt-BR/desktop.json'
import { testFrames } from '../../../../desktop/autotune/testRecording'
import { desktopBridge, type DesktopBridge } from '../../../../desktop/bridge'
import { chainOf } from '../../../../desktop/slots'
import type { NoiseRegion, Stretch, VoiceNoise } from '../../../../desktop/spectrum/voiceNoise'
import { engineSlots, entries, snapshot } from '../../../../desktop/testChain'
import type { TuneChange, TuneInput, TuneResult } from '../../../../desktop/tune'
import type { TuneSession } from '../../../../desktop/tune/renderer'
import { testTake } from '../../../../desktop/tune/testTake'
import type { AudioFrame } from '../../../../desktop/types'
import { theme } from '../../../../theme'
import { DesktopScreen } from '../../DesktopScreen'
import type { SpectrumPlot } from '../../tuning/spectrum/SpectrumPlot'
import { installFakeAudio, type FakeAudio } from '../testAudio'

type PlotProps = ComponentProps<typeof SpectrumPlot>

// the tuner, the take's analysis, the voice / noise measure and the re-measure are other modules' jobs: fakes
const h = vi.hoisted(() => ({
  tune: null as null | ((input: TuneInput) => Promise<TuneResult>),
  stretches: [] as Stretch[],
  plot: null as null | PlotProps,
  measured: [] as Float32Array[],
}))
vi.mock('../../../../desktop/tune', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../../desktop/tune')>()
  return { ...real, tune: (input: TuneInput) => (h.tune ?? real.tune)(input) }
})
vi.mock('../../../../desktop/spectrum/take', async () => {
  const { SPECTRUM_POINTS: n } = await import('../../../../desktop/spectrum/types')
  return {
    createTakeAnalyzer: () => {
      const spectrum = { freqsHz: new Float32Array(n), rawDb: new Float32Array(n).fill(-80), processedDb: new Float32Array(n).fill(-60), tones: [] }
      return { push: () => undefined, reset: () => undefined, seek: () => undefined, read: () => spectrum }
    },
  }
})
vi.mock('../../../../desktop/autotune/manualEq', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../../desktop/autotune/manualEq')>()
  return { ...real, remeasured: (_take: Float32Array, result: TuneResult, processed: Float32Array): TuneResult => ({ ...result, processed }) }
})
vi.mock('../../../../desktop/spectrum/voiceNoise', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../../desktop/spectrum/voiceNoise')>()
  const { SPECTRUM_POINTS: n } = await import('../../../../desktop/spectrum/types')
  const region = (id: NoiseRegion['id'], noiseDb: number, underVoiceDb: number): NoiseRegion => ({ id, loHz: 0, hiHz: 0, noiseDb, underVoiceDb })
  /** Region levels [noise, under the voice] of the take (Before) and of each render by its first sample. */
  const LEVELS: Record<string, [number, number][]> = {
    take: [[-50, 29], [-55, 34], [-60, 39]],
    '0.1875': [[-51, 30], [-80, 29.9], [-125, 104]],
    '0.25': [[-66, 45], [-82, 61], [-121, 100]],
  }
  const vn = (key: string, voiceDb: number, noiseDb: number): VoiceNoise => {
    const [low, mid, high] = LEVELS[key]
    return {
      freqsHz: new Float32Array(n),
      voiceDb: new Float32Array(n).fill(voiceDb),
      noiseDb: new Float32Array(n).fill(noiseDb),
      voiceLevelDb: -21,
      noiseLevelDb: noiseDb,
      regions: [region('low', ...low), region('mid', ...mid), region('high', ...high)],
    }
  }
  return {
    ...real,
    noiseStretches: () => h.stretches,
    voiceNoiseOf: (audio: Float32Array, take: Float32Array, stretches: readonly Stretch[]) => {
      if (stretches.length === 0) return null
      h.measured.push(audio)
      return audio === take ? vn('take', -40, -90) : vn(String(audio[0]), audio[0] === 0.25 ? -25 : -30, -100)
    },
    // a render's noise is half its first sample; the take's is 0.5
    noiseOnly: (audio: Float32Array, stretches: readonly Stretch[]) =>
      stretches.length === 0 ? new Float32Array(0) : new Float32Array(48000 * 5).fill(String(audio[0]) in LEVELS ? audio[0] / 2 : 0.5),
  }
})
vi.mock('../../tuning/spectrum/SpectrumPlot', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../tuning/spectrum/SpectrumPlot')>()
  // the real plot (handles, keys), with what it was given kept for the test
  return {
    SpectrumPlot: (p: PlotProps) => {
      h.plot = p
      return createElement(real.SpectrumPlot, p)
    },
  }
})

const U = en.desktop.autotune.ui
const P = U.spectrum
const TAKE = testTake({ quietSec: 3, speechSec: 22 })
const PROCESSED = new Float32Array(TAKE.length).fill(0.1875)
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
const resultOf = (goals: TuneInput['goals']): TuneResult => ({ changes: [CHANGE], before: summary(-30), after: summary(-21), processed: PROCESSED, renders: 6, unmet: [], log: [], goals, limit: 1 })

function fakes() {
  let onFrame: ((f: AudioFrame) => void) | null = null
  const renders: ((x: Float32Array) => Promise<void>)[] = []
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
  }
  const session: TuneSession = {
    chain: chainOf(engineSlots(), entries()),
    render: vi.fn(() => new Promise<Float32Array>((resolve) => void renders.push((x) => act(async () => resolve(x))))),
    exportChanges: vi.fn(async () => []),
    setState: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  }
  return { bridge, session, open: vi.fn(async () => session), push: (frames: AudioFrame[]) => act(() => frames.forEach((f) => onFrame?.(f))), renders }
}

async function tuned() {
  const f = fakes()
  render(
    <ThemeProvider theme={theme}>
      <DesktopScreen bridge={f.bridge} openSession={f.open} />
    </ThemeProvider>,
  )
  const start = await screen.findByRole('button', { name: U.record.start })
  await waitFor(() => expect(start).not.toHaveProperty('disabled', true))
  fireEvent.click(start)
  await waitFor(() => expect(f.bridge.audioStart).toHaveBeenCalled())
  f.push(testFrames(TAKE))
  await screen.findByRole('heading', { name: U.goals.title })
  h.tune = vi.fn(async (input: TuneInput) => resultOf(input.goals))
  fireEvent.click(screen.getByRole('button', { name: U.goals.tune }))
  await screen.findByTestId('take-spectrum')
  return f
}

const card = () => screen.getByTestId('take-spectrum')
const plotted = () => {
  const s = h.plot?.analyzer.read()
  return { voice: s?.processedDb[0], noise: s?.rawDb[0], line: h.plot?.rawLine ?? 'text.secondary' }
}
const row = (id: string) => screen.getByTestId(`take-noise-${id}`)
const viewButton = (name: string) => within(card()).getByRole('button', { name })

let audio: FakeAudio
beforeAll(async () => {
  await i18n.changeLanguage('en')
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})
beforeEach(() => {
  audio = installFakeAudio()
  h.stretches = [{ from: 0, to: 144000 }]
  h.plot = null
  h.measured = []
})
afterEach(() => {
  cleanup()
  audio.uninstall()
  h.tune = null
  localStorage.clear()
})

// the first render of the screen is slow when the whole suite runs at once
vi.setConfig({ testTimeout: 20000 })

describe('result step: voice and noise', () => {
  it('without noise stretches: no Noise only, no view toggle, no "In your noise"', async () => {
    h.stretches = []
    await tuned()
    expect(screen.queryByLabelText(U.result.player.noiseOnly)).toBeNull()
    expect(within(card()).queryByRole('button', { name: P.view.voiceNoise })).toBeNull()
    expect(screen.queryByTestId('take-noise')).toBeNull()
    expect(plotted()).toEqual({ voice: -60, noise: -80, line: 'text.secondary' })
  })

  it('Noise only plays the noise-only audio of the picked side, from the start', async () => {
    await tuned()
    fireEvent.click(screen.getByLabelText(U.result.player.noiseOnly))
    expect(screen.getByTestId('autotune-noise-only-help').textContent).toBe(U.result.player.noiseOnlyHelp)
    expect(screen.getByTestId('autotune-ab-time').textContent).toBe('0:00 / 0:05')
    fireEvent.click(screen.getByRole('button', { name: U.result.play }))
    expect(audio.sources[0].start).toHaveBeenCalledWith(0, 0)
    expect(audio.sources[0].buffer?.data[0]).toBe(0.1875 / 2)
    fireEvent.click(screen.getByRole('button', { name: U.result.before }))
    expect(audio.sources[1].buffer?.data[0]).toBe(0.5)
    // off again: the whole recording
    fireEvent.click(screen.getByLabelText(U.result.player.noiseOnly))
    expect(screen.getByTestId('autotune-ab-time').textContent).toBe('0:00 / 0:25')
  })

  it('the view toggle swaps the curves and the legend, follows Before / After, and does not touch the bands', async () => {
    await tuned()
    expect(viewButton(P.view.whole).getAttribute('aria-pressed')).toBe('true')
    expect(plotted()).toEqual({ voice: -60, noise: -80, line: 'text.secondary' })
    expect(within(card()).getByText(P.legend.before)).toBeTruthy()
    fireEvent.click(viewButton(P.view.voiceNoise))
    expect(plotted()).toEqual({ voice: -30, noise: -100, line: 'error.main' })
    expect(within(card()).getByText(P.legend.voice)).toBeTruthy()
    expect(within(card()).getByText(P.legend.noise)).toBeTruthy()
    expect(within(card()).queryByText(P.legend.before)).toBeNull()
    expect(within(card()).getByText(en.desktop.tune.spectrum.legend.eq)).toBeTruthy()
    expect(within(card()).getByRole('group', { name: P.voiceNoise.aria })).toBeTruthy()
    expect(screen.getByTestId('spectrum-band-2')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: U.result.before }))
    expect(plotted()).toEqual({ voice: -40, noise: -90, line: 'error.main' })
    fireEvent.click(viewButton(P.view.whole))
    expect(plotted()).toEqual({ voice: -60, noise: -80, line: 'text.secondary' })
  })

  it('"In your noise": before → after per region, how far under the voice, audible under the threshold', async () => {
    await tuned()
    const noise = screen.getByTestId('take-noise')
    expect(within(noise).getByRole('heading', { name: P.noise.title })).toBeTruthy()
    expect(within(noise).getByText(P.noise.caption)).toBeTruthy()
    expect(row('low').textContent).toContain(P.noise.low)
    expect(row('low').textContent).toContain('-50.0 dBFS → -51.0 dBFS')
    expect(row('low').textContent).toContain('30.0 dB under your voice')
    expect(within(row('low')).queryByTestId('take-noise-audible')).toBeNull() // exactly at the threshold
    expect(row('mid').textContent).toContain('-55.0 dBFS → -80.0 dBFS')
    expect(within(row('mid')).getByTestId('take-noise-audible').textContent).toBe(P.noise.audible)
    expect(row('high').textContent).toContain(`-60.0 dBFS → ${U.result.metrics.note.silence}`)
    expect(row('high').textContent).not.toContain('under your voice')
    expect(within(row('high')).queryByTestId('take-noise-audible')).toBeNull()
  })

  it('a hand edit (a new render) updates the after values, the voice / noise curves and Noise only', async () => {
    const f = await tuned()
    fireEvent.click(viewButton(P.view.voiceNoise))
    fireEvent.keyDown(screen.getByTestId('spectrum-band-2'), { key: 'ArrowUp' })
    await waitFor(() => expect(f.session.render).toHaveBeenCalledTimes(1))
    await f.renders[0](new Float32Array(TAKE.length).fill(0.25))
    await waitFor(() => expect(row('low').textContent).toContain('-50.0 dBFS → -66.0 dBFS'))
    expect(row('mid').textContent).toContain('61.0 dB under your voice')
    expect(screen.queryByTestId('take-noise-audible')).toBeNull()
    expect(plotted()).toEqual({ voice: -25, noise: -100, line: 'error.main' })
    fireEvent.click(screen.getByLabelText(U.result.player.noiseOnly))
    fireEvent.click(screen.getByRole('button', { name: U.result.play }))
    expect(audio.sources.at(-1)?.buffer?.data[0]).toBe(0.125)
  })
})

describe('voice and noise strings', () => {
  it('en and pt-BR', () => {
    for (const k of ['whole', 'voiceNoise', 'label'] as const) expect(pt.desktop.autotune.ui.spectrum.view[k]).toBeTruthy()
    expect(pt.desktop.autotune.ui.spectrum.view.whole).toBe('Gravação inteira')
    expect(pt.desktop.autotune.ui.spectrum.view.voiceNoise).toBe('Voz e ruído')
    expect(pt.desktop.autotune.ui.spectrum.legend.voice).toBe('Voz')
    expect(pt.desktop.autotune.ui.spectrum.legend.noise).toBe('Ruído (quando você não fala)')
    expect(pt.desktop.autotune.ui.spectrum.noise.title).toBe('No seu ruído')
    expect(pt.desktop.autotune.ui.spectrum.noise.low).toBe('graves, abaixo de 250 Hz')
    expect(pt.desktop.autotune.ui.spectrum.noise.mid).toBe('médios, 250 Hz a 4 kHz')
    expect(pt.desktop.autotune.ui.spectrum.noise.high).toBe('agudos, acima de 4 kHz')
    expect(pt.desktop.autotune.ui.spectrum.noise.under).toBe('{{db}} abaixo da sua voz')
    expect(pt.desktop.autotune.ui.spectrum.noise.audible).toBe('audível')
    expect(pt.desktop.autotune.ui.spectrum.noise.caption).toBe('Medido onde você não fala: os 3 segundos de silêncio do começo e as pausas.')
    expect(pt.desktop.autotune.ui.result.player.noiseOnly).toBe('Só ruído')
    expect(pt.desktop.autotune.ui.result.player.noiseOnlyHelp).toBe('Toca só os momentos em que você não está falando: o silêncio do começo e as pausas.')
    expect(en.desktop.autotune.ui.result.player.noiseOnly).toBe('Noise only')
    expect(en.desktop.autotune.ui.spectrum.noise.under).toBe('{{db}} under your voice')
    expect(Object.keys(pt.desktop.autotune.ui.spectrum.voiceNoise)).toEqual(Object.keys(en.desktop.autotune.ui.spectrum.voiceNoise))
  })
})
