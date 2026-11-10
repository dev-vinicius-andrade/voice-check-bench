import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import i18n from '../../i18n'
import { LiveStartError, type LiveConfig, type LiveError, type LiveMetrics, type LiveSessionApi, type LiveSide } from '../../live/types'
import { useBench } from '../../store/benchStore'
import { theme } from '../../theme'
import { LIVE_DEVICES_KEY, pickLiveDevices } from './liveDevices'
import { LiveScreen } from './LiveScreen'
import { LoudnessCard } from './LoudnessCard'
import { ToneCard } from './ToneCard'

vi.mock('../../storage/takesDb', () => ({
  openTakesDb: async () => ({ available: true, all: async () => [], put: async () => undefined, remove: async () => undefined, clear: async () => undefined }),
}))
vi.mock('../../store/engine', () => ({ getEngine: () => ({ sampleRate: 48000, isSupported: () => true }) }))

/** Test double for the engine: records calls, emits metrics on demand, can fail start with a LiveError. */
class FakeSession implements LiveSessionApi {
  starts: LiveConfig[] = []
  stops = 0
  failWith: LiveError | null = null
  private subs = new Set<(m: LiveMetrics) => void>()
  async start(cfg: LiveConfig): Promise<void> {
    this.starts.push(cfg)
    if (this.failWith) throw new LiveStartError(this.failWith)
  }
  stop(): void {
    this.stops++
  }
  subscribe(fn: (m: LiveMetrics) => void): () => void {
    this.subs.add(fn)
    return () => this.subs.delete(fn)
  }
  emit(m: LiveMetrics): void {
    for (const f of this.subs) f(m)
  }
}

const side = (p: Partial<LiveSide> = {}): LiveSide => ({
  speechDb: -20,
  peakDb: -6,
  clipFrames: 0,
  pauseDb: -71,
  deadSilence: 0,
  tone: [0, 1, -2, 4, 0, -7, 2, 0, 1],
  ...p,
})
const metrics = (p: Partial<LiveMetrics> = {}): LiveMetrics => ({
  talkSec: 3,
  raw: side({ speechDb: -30, pauseDb: -38, tone: [0, 0, 0, 0, 0, 0, 0, 0, 0] }),
  fx: side(),
  lagMs: 12,
  sync: 0.9,
  hints: [{ key: 'live.hints.empty' }],
  ...p,
})

const DEVICES = [
  { deviceId: 'mic', label: 'Mic In (Elgato Wave:3)' },
  { deviceId: 'stream', label: 'Stream Mix (Elgato Wave:3)' },
]

const wrap = (ui: React.ReactNode) => render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
let fake: FakeSession
const renderLive = () => wrap(<LiveScreen createSession={() => fake} />)

beforeAll(async () => {
  await i18n.changeLanguage('en')
})
beforeEach(() => {
  try {
    localStorage.clear()
  } catch {
    // storage blocked
  }
  fake = new FakeSession()
  useBench.setState({ devices: DEVICES, deviceChoice: { raw: 'mic', fx: null } })
})
afterEach(() => cleanup())

const start = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Start listening' }))
  await act(async () => undefined)
}

describe('LiveScreen', () => {
  it('starts with the picked inputs, shows the read prompt, then the panels with values', async () => {
    renderLive()
    expect(screen.getByTestId('live-read')).toBeTruthy()
    await start()
    expect(fake.starts).toEqual([{ rawId: 'mic', fxId: 'stream' }])
    expect(screen.getByTestId('live-read-prompt')).toBeTruthy()
    expect(screen.queryByTestId('live-panels')).toBeNull()

    act(() => fake.emit(metrics({ fx: side({ clipFrames: 3, deadSilence: 0.2 }) })))
    expect(screen.getByTestId('live-status').textContent).toBe('Listening · in sync (12 ms)')
    expect(screen.getByTestId('live-level').textContent).toBe('-20.0 dBFS')
    expect(screen.getByTestId('live-level-word').textContent).toBe('Good')
    expect(screen.getByTestId('live-clip').textContent).toBe('Clipping in 3 moments in the last 4 s')
    expect(screen.getByTestId('live-pause-values').textContent).toBe('-38 → -71 dB')
    expect(screen.getByText('33 dB quieter than raw')).toBeTruthy()
    expect(screen.getByTestId('live-dead').textContent).toBe('20% dead silence: noise removal too strong')
    expect(within(screen.getByTestId('live-hints')).getByText('Nothing to change right now. Keep talking.')).toBeTruthy()
    expect(screen.queryByTestId('live-read-prompt')).toBeNull()
  })

  it('stops on Stop and on unmount, and saves the pick', async () => {
    const view = renderLive()
    await start()
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(fake.stops).toBeGreaterThanOrEqual(1)
    const before = fake.stops
    view.unmount()
    expect(fake.stops).toBe(before + 1)
  })

  it('shows "lining up" until the delay is known', async () => {
    renderLive()
    await start()
    act(() => fake.emit(metrics({ lagMs: null })))
    expect(screen.getByTestId('live-status').textContent).toBe('Listening · lining up…')
  })

  it.each<LiveError>(['unsupported', 'permission', 'fxUnavailable', 'sameDevice', 'other'])('shows the %s error', async (code) => {
    fake.failWith = code
    renderLive()
    await start()
    expect(screen.getByTestId(`live-error-${code}`).textContent).toBe(i18n.t(`live.error.${code}`))
    expect(screen.queryByRole('button', { name: 'Use only the Wave Link output' })).toBeNull()
  })

  it('rawUnavailable offers to run on the Wave Link output only', async () => {
    fake.failWith = 'rawUnavailable'
    renderLive()
    await start()
    fake.failWith = null
    fireEvent.click(screen.getByRole('button', { name: 'Use only the Wave Link output' }))
    await act(async () => undefined)
    expect(fake.starts.at(-1)).toEqual({ rawId: null, fxId: 'stream' })
    expect(screen.getByTestId('live-status').textContent).toBe('Listening · only Wave Link output')
    expect(JSON.parse(localStorage.getItem(LIVE_DEVICES_KEY) ?? 'null')).toEqual({ raw: null, fx: 'stream' })
  })
})

describe('live cards', () => {
  it('LoudnessCard calls a loud peak too loud and places both markers', () => {
    wrap(<LoudnessCard metrics={metrics({ fx: side({ speechDb: -20, peakDb: -0.5 }) })} />)
    expect(screen.getByTestId('live-level-word').textContent).toBe('Too loud')
    expect(screen.getByTestId('live-marker-raw')).toBeTruthy()
    expect(screen.getByTestId('live-marker-fx')).toBeTruthy()
    expect(screen.queryByTestId('live-clip')).toBeNull()
  })

  it('LoudnessCard says too quiet below the target range', () => {
    wrap(<LoudnessCard metrics={metrics({ raw: null, fx: side({ speechDb: -40 }) })} />)
    expect(screen.getByTestId('live-level-word').textContent).toBe('Too quiet')
    expect(screen.queryByTestId('live-marker-raw')).toBeNull()
  })

  it('ToneCard has one labelled row per band, boom to air', () => {
    wrap(<ToneCard metrics={metrics()} />)
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(8)
    expect(rows[0].getAttribute('aria-label')).toBe('Boom: raw mic 0.0 dB, Wave Link +1.0 dB from your goal')
    expect(rows[4].getAttribute('aria-label')).toBe('Definition: raw mic 0.0 dB, Wave Link -7.0 dB from your goal')
    expect(screen.queryByTestId('live-tone-wait')).toBeNull()
  })

  it('ToneCard asks to keep talking under 1 s of speech', () => {
    wrap(<ToneCard metrics={metrics({ talkSec: 0.4 })} />)
    expect(screen.getByTestId('live-tone-wait').textContent).toBe('Keep talking to see your tone')
  })
})

describe('pickLiveDevices', () => {
  it('uses the check choice, a Wave Link name for fx, and honours a saved "None"', () => {
    expect(pickLiveDevices(DEVICES, { raw: 'mic', fx: null }, null)).toEqual({ raw: 'mic', fx: 'stream' })
    expect(pickLiveDevices(DEVICES, { raw: 'mic', fx: null }, { raw: null, fx: 'stream' })).toEqual({ raw: null, fx: 'stream' })
    expect(pickLiveDevices(DEVICES, { raw: 'gone', fx: 'gone' }, { fx: 'gone' })).toEqual({ raw: null, fx: 'stream' })
  })
})
