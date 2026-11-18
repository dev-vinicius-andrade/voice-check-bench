import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import i18n from '../../../i18n'
import en from '../../../i18n/locales/en/desktop.json'
import type { SaveWav } from '../../../desktop/bridge'
import { theme } from '../../../theme'
import { AbPlayer, AbPlayerView } from './AbPlayer'
import { installFakeAudio, type FakeAudio } from './testAudio'
import { TICK_MS, useAbPlayer, type NoisePair } from './useAbPlayer'

const U = en.desktop.autotune.ui.result
const SR = 48000
const BEFORE = new Float32Array(SR * 25).fill(0.25)
const AFTER = new Float32Array(SR * 25).fill(1.5)

function view(impl: SaveWav = async () => 'C:\\Users\\me\\Downloads\\x.wav') {
  const saveWav = vi.fn(impl)
  render(
    <ThemeProvider theme={theme}>
      <AbPlayer before={BEFORE} after={AFTER} saveWav={saveWav} />
    </ThemeProvider>,
  )
  return saveWav
}

const time = (): string => screen.getByTestId('autotune-ab-time').textContent ?? ''
const button = (name: string): HTMLElement => screen.getByRole('button', { name })
const tick = (ms = TICK_MS): void => act(() => void vi.advanceTimersByTime(ms))

let audio: FakeAudio
beforeAll(() => i18n.changeLanguage('en'))
beforeEach(() => {
  audio = installFakeAudio()
})
afterEach(() => {
  cleanup()
  audio.uninstall()
  vi.useRealTimers()
})

describe('A/B player controls', () => {
  it('shows elapsed / total and follows the playback', () => {
    vi.useFakeTimers()
    view()
    expect(time()).toBe('0:00 / 0:25')
    fireEvent.click(button(U.play))
    expect(audio.sources[0].start).toHaveBeenCalledWith(0, 0)
    audio.ctx().currentTime = 4.5
    tick()
    expect(time()).toBe('0:04 / 0:25')
    expect((screen.getByRole('slider', { name: U.position }) as HTMLInputElement).value).toBe('4.5')
  })

  it('Pause keeps the position, Stop goes back to the start', () => {
    vi.useFakeTimers()
    view()
    fireEvent.click(button(U.play))
    audio.ctx().currentTime = 7
    fireEvent.click(button(U.pause))
    expect(audio.sources[0].stop).toHaveBeenCalled()
    expect(time()).toBe('0:07 / 0:25')
    fireEvent.click(button(U.play))
    expect(audio.sources[1].start).toHaveBeenCalledWith(0, 7)
    audio.ctx().currentTime = 9
    fireEvent.click(button(U.stop))
    expect(audio.sources[1].stop).toHaveBeenCalled()
    expect(button(U.play)).toBeTruthy()
    expect(time()).toBe('0:00 / 0:25')
    fireEvent.click(button(U.play))
    expect(audio.sources[2].start).toHaveBeenCalledWith(0, 0)
  })

  it('the bar seeks: paused it moves the position, playing it plays on from there', () => {
    vi.useFakeTimers()
    view()
    const bar = screen.getByRole('slider', { name: U.position })
    fireEvent.change(bar, { target: { value: '12' } })
    expect(time()).toBe('0:12 / 0:25')
    expect(audio.sources).toHaveLength(0)
    fireEvent.click(button(U.play))
    expect(audio.sources[0].start).toHaveBeenCalledWith(0, 12)
    audio.ctx().currentTime = 1
    fireEvent.change(bar, { target: { value: '20' } })
    expect(audio.sources[0].stop).toHaveBeenCalled()
    expect(audio.sources[1].start).toHaveBeenCalledWith(0, 20)
    expect(time()).toBe('0:20 / 0:25')
  })

  it('Before / After switches at the same position, playing or paused', () => {
    vi.useFakeTimers()
    view()
    fireEvent.click(button(U.play))
    audio.ctx().currentTime = 3
    fireEvent.click(button(U.before))
    expect(audio.sources[1].start).toHaveBeenCalledWith(0, 3)
    audio.ctx().currentTime = 5
    fireEvent.click(button(U.pause))
    fireEvent.click(button(U.after))
    expect(audio.sources).toHaveLength(2)
    expect(time()).toBe('0:05 / 0:25')
    fireEvent.click(button(U.play))
    expect(audio.sources[2].start).toHaveBeenCalledWith(0, 5)
  })

  it('a new After render switches the sound at the same position, playing or paused', () => {
    vi.useFakeTimers()
    const tree = (after: Float32Array) => (
      <ThemeProvider theme={theme}>
        <AbPlayer before={BEFORE} after={after} />
      </ThemeProvider>
    )
    const r = render(tree(AFTER))
    fireEvent.click(button(U.play))
    audio.ctx().currentTime = 6
    tick()
    const next = new Float32Array(SR * 25).fill(0.5)
    r.rerender(tree(next))
    expect(audio.sources[0].stop).toHaveBeenCalled()
    expect(audio.sources).toHaveLength(2)
    expect(audio.sources[1].start).toHaveBeenCalledWith(0, 6)
    expect(audio.sources[1].buffer?.data[0]).toBe(0.5)
    expect(button(U.pause)).toBeTruthy()
    expect(time()).toBe('0:06 / 0:25')
    audio.ctx().currentTime = 9
    fireEvent.click(button(U.pause))
    const last = new Float32Array(SR * 25).fill(0.25)
    r.rerender(tree(last))
    expect(audio.sources).toHaveLength(2)
    expect(time()).toBe('0:09 / 0:25')
    fireEvent.click(button(U.play))
    expect(audio.sources[2].start).toHaveBeenCalledWith(0, 9)
    expect(audio.sources[2].buffer?.data[0]).toBe(0.25)
  })

  it('the end of the take goes back to the start', () => {
    vi.useFakeTimers()
    view()
    fireEvent.click(button(U.play))
    audio.ctx().currentTime = 25
    tick()
    act(() => audio.sources[0].onended?.())
    expect(button(U.play)).toBeTruthy()
    expect(time()).toBe('0:00 / 0:25')
  })
})

describe('Download', () => {
  it('saves Before as the raw take, After as the render, as 16-bit 48 kHz WAVs, and says where', async () => {
    const saveWav = view()
    fireEvent.click(button(U.download.before))
    expect(await screen.findByTestId('autotune-download-saved')).toHaveProperty('textContent', 'Saved to C:\\Users\\me\\Downloads\\x.wav')
    fireEvent.click(button(U.download.after))
    await waitFor(() => expect(saveWav).toHaveBeenCalledTimes(2))
    const calls = saveWav.mock.calls
    expect(calls[0][0]).toMatch(/^voice-check-before-\d{4}-\d{2}-\d{2}-\d{4}\.wav$/)
    expect(calls[1][0]).toMatch(/^voice-check-after-\d{4}-\d{2}-\d{2}-\d{4}\.wav$/)
    for (const [, wav] of calls) {
      const v = new DataView(wav)
      expect([v.getUint32(24, true), v.getUint16(34, true), v.getUint16(22, true)]).toEqual([SR, 16, 1])
      expect(v.getUint32(40, true)).toBe(SR * 25 * 2)
    }
    expect(new DataView(calls[0][1]).getInt16(44, true)).toBe(Math.round(0.25 * 0x7fff))
    expect(new DataView(calls[1][1]).getInt16(44, true)).toBe(0x7fff) // clamped
  })

  it('a failed save is a plain error', async () => {
    view(async () => Promise.reject({ code: 'writeFailed', message: 'Access is denied' }))
    fireEvent.click(button(U.download.after))
    expect((await screen.findByTestId('autotune-download-error')).textContent).toBe(U.download.writeFailed)
    expect(screen.queryByTestId('autotune-download-saved')).toBeNull()
  })

  it('works without Web Audio', async () => {
    audio.uninstall()
    view()
    expect(screen.getByText(U.noAudio)).toBeTruthy()
    fireEvent.click(button(U.download.before))
    expect(await screen.findByTestId('autotune-download-saved')).toBeTruthy()
  })
})

const NOISE: NoisePair = { before: new Float32Array(SR * 5).fill(0.125), after: new Float32Array(SR * 5).fill(0.0625) }

/** The result step's way: the player state owned outside the view, with noise-only audio. */
function Owned({ noise, saveWav }: { noise: NoisePair | null; saveWav?: SaveWav }) {
  const p = useAbPlayer(BEFORE, AFTER, noise)
  return <AbPlayerView before={BEFORE} after={AFTER} saveWav={saveWav} p={p} />
}
function owned(noise: NoisePair | null = NOISE, saveWav?: SaveWav) {
  return render(
    <ThemeProvider theme={theme}>
      <Owned noise={noise} saveWav={saveWav} />
    </ThemeProvider>,
  )
}
const noiseSwitch = (): HTMLElement => screen.getByLabelText(U.player.noiseOnly)
const played = (i: number): number => audio.sources[i].buffer?.data[0] ?? NaN

describe('Noise only', () => {
  it('is not there without noise-only audio (and not on the plain player)', () => {
    owned(null)
    expect(screen.queryByLabelText(U.player.noiseOnly)).toBeNull()
    cleanup()
    view()
    expect(screen.queryByLabelText(U.player.noiseOnly)).toBeNull()
  })

  it('off: the take and its render as before, no help line', () => {
    vi.useFakeTimers()
    owned()
    expect(time()).toBe('0:00 / 0:25')
    expect(screen.queryByTestId('autotune-noise-only-help')).toBeNull()
    fireEvent.click(button(U.play))
    expect(played(0)).toBe(1) // After, clamped
  })

  it('on: plays the noise-only audio of the picked side, Before / After keeps the position, duration and seek follow it', () => {
    vi.useFakeTimers()
    owned()
    fireEvent.click(noiseSwitch())
    expect(screen.getByTestId('autotune-noise-only-help').textContent).toBe(U.player.noiseOnlyHelp)
    expect(time()).toBe('0:00 / 0:05')
    fireEvent.click(button(U.play))
    expect(played(0)).toBe(0.0625)
    audio.ctx().currentTime = 2
    fireEvent.click(button(U.before))
    expect(played(1)).toBe(0.125)
    expect(audio.sources[1].start).toHaveBeenCalledWith(0, 2)
    fireEvent.change(screen.getByRole('slider', { name: U.position }), { target: { value: '4' } })
    expect(audio.sources[2].start).toHaveBeenCalledWith(0, 4)
    expect(time()).toBe('0:04 / 0:05')
  })

  it('switching the mode stops and goes back to the start, both ways', () => {
    vi.useFakeTimers()
    owned()
    fireEvent.click(button(U.play))
    audio.ctx().currentTime = 7
    tick()
    expect(time()).toBe('0:07 / 0:25')
    fireEvent.click(noiseSwitch())
    expect(audio.sources[0].stop).toHaveBeenCalled()
    expect(button(U.play)).toBeTruthy()
    expect(time()).toBe('0:00 / 0:05')
    fireEvent.click(button(U.play))
    expect(audio.sources[1].start).toHaveBeenCalledWith(0, 0)
    audio.ctx().currentTime = 10
    tick()
    fireEvent.click(noiseSwitch())
    expect(audio.sources[1].stop).toHaveBeenCalled()
    expect(time()).toBe('0:00 / 0:25')
    expect(screen.queryByTestId('autotune-noise-only-help')).toBeNull()
    fireEvent.click(button(U.play))
    expect(audio.sources[2].start).toHaveBeenCalledWith(0, 0)
    expect(played(2)).toBe(1)
  })

  it('a new noise-only After (a new render) switches the sound at the same position', () => {
    vi.useFakeTimers()
    const tree = (noise: NoisePair) => (
      <ThemeProvider theme={theme}>
        <Owned noise={noise} />
      </ThemeProvider>
    )
    const r = render(tree(NOISE))
    fireEvent.click(noiseSwitch())
    fireEvent.click(button(U.play))
    audio.ctx().currentTime = 3
    tick()
    r.rerender(tree({ before: NOISE.before, after: new Float32Array(SR * 5).fill(0.03125) }))
    expect(audio.sources[0].stop).toHaveBeenCalled()
    expect(audio.sources[1].start).toHaveBeenCalledWith(0, 3)
    expect(played(1)).toBe(0.03125)
    expect(time()).toBe('0:03 / 0:05')
  })

  it('downloads stay the full files', async () => {
    const saveWav = vi.fn(async () => 'saved.wav')
    owned(NOISE, saveWav)
    fireEvent.click(noiseSwitch())
    fireEvent.click(button(U.download.after))
    await waitFor(() => expect(saveWav).toHaveBeenCalledTimes(1))
    const wav = saveWav.mock.calls[0] as unknown as [string, ArrayBuffer]
    expect(new DataView(wav[1]).getUint32(40, true)).toBe(SR * 25 * 2)
  })
})
