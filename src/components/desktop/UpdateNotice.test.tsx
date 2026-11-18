import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import i18n from '../../i18n'
import type { AvailableUpdate, UpdateProgress } from '../../desktop/updater'
import { theme } from '../../theme'
import { UpdateCheckButton } from './UpdateCheckButton'
import { UpdateNotice } from './UpdateNotice'

beforeAll(() => i18n.changeLanguage('en'))
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function fake(install: AvailableUpdate['install'] = async () => true) {
  const update: AvailableUpdate = { version: '2.0.0-alpha.2', install: vi.fn(install), dismiss: vi.fn(async () => {}) }
  return { update, check: vi.fn(async () => update) }
}

const view = (check: () => Promise<AvailableUpdate | null>, delayMs = 3000) =>
  render(
    <ThemeProvider theme={theme}>
      <UpdateNotice check={check} delayMs={delayMs} />
    </ThemeProvider>,
  )

describe('UpdateNotice', () => {
  it('checks once after the delay and offers the version', async () => {
    vi.useFakeTimers()
    const { check } = fake()
    view(check)
    expect(check).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(check).toHaveBeenCalledOnce()
    expect(screen.getByText('Version 2.0.0-alpha.2 is available.')).toBeTruthy()
  })

  it('shows nothing when there is no update', async () => {
    const check = vi.fn(async () => null)
    view(check, 0)
    await act(async () => {})
    expect(check).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('Later dismisses the update', async () => {
    const { update, check } = fake()
    view(check, 0)
    fireEvent.click(await screen.findByRole('button', { name: 'Later' }))
    expect(update.dismiss).toHaveBeenCalledOnce()
    expect(screen.queryByText(/is available/)).toBeNull()
  })

  it('checks again while the app stays open', async () => {
    vi.useFakeTimers()
    const { update } = fake()
    const check = vi.fn<() => Promise<AvailableUpdate | null>>(async () => null)
    render(
      <ThemeProvider theme={theme}>
        <UpdateNotice check={check} delayMs={3000} recheckMs={60000} />
      </ThemeProvider>,
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(screen.queryByText(/is available/)).toBeNull()
    check.mockResolvedValue(update)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000)
    })
    expect(check).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Version 2.0.0-alpha.2 is available.')).toBeTruthy()
  })

  it('after Later only "Check for updates" offers it again', async () => {
    vi.useFakeTimers()
    const { check } = fake()
    render(
      <ThemeProvider theme={theme}>
        <UpdateNotice check={check} delayMs={0} recheckMs={60000} />
        <UpdateCheckButton />
      </ThemeProvider>,
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Later' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180000)
    })
    expect(check).toHaveBeenCalledOnce()
    expect(screen.queryByText(/is available/)).toBeNull()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
    })
    expect(check).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Version 2.0.0-alpha.2 is available.')).toBeTruthy()
  })

  it('"Check for updates" says when nothing newer was found', async () => {
    const check = vi.fn(async () => null)
    render(
      <ThemeProvider theme={theme}>
        <UpdateNotice check={check} delayMs={600000} />
        <UpdateCheckButton />
      </ThemeProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
    expect(await screen.findByText('No newer version found.')).toBeTruthy()
    expect(check).toHaveBeenCalledOnce()
  })

  it('shows progress while installing, and a retry when it fails', async () => {
    let report: ((p: UpdateProgress) => void) | undefined
    let finish: ((ok: boolean) => void) | undefined
    const { update, check } = fake(
      (onProgress) =>
        new Promise<boolean>((resolve) => {
          report = onProgress
          finish = resolve
        }),
    )
    view(check, 0)
    fireEvent.click(await screen.findByRole('button', { name: 'Install and restart' }))
    expect(update.install).toHaveBeenCalledOnce()
    expect(screen.getByText('Installing version 2.0.0-alpha.2…')).toBeTruthy()
    act(() => report?.({ downloaded: 50, total: 100 }))
    expect(screen.getByText('Installing version 2.0.0-alpha.2… 50%')).toBeTruthy()
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50')
    await act(async () => finish?.(false))
    expect(screen.getByText(/could not be installed/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })
})
