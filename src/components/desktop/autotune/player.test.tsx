import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import i18n from '../../../i18n'
import en from '../../../i18n/locales/en/desktop.json'
import type { SaveWav } from '../../../desktop/bridge'
import { theme } from '../../../theme'
import { AbPlayer } from './AbPlayer'
import { installFakeAudio, type FakeAudio } from './testAudio'
import { TICK_MS } from './useAbPlayer'

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
