import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import i18n from '../../i18n'
import { theme } from '../../theme'
import { settingsText, suggestionFixture } from '../../wavelink/testFixtures'
import type { WlApplyPlan, WlFile } from '../../wavelink/types'
import { WaveLinkApplyDialog } from './WaveLinkApplyDialog'
import { backupName } from './wlFiles'

const plan = (_f: WlFile, inputKey: string): WlApplyPlan => ({
  inputKey,
  suggestion: suggestionFixture({ chain: ['ReaFIR', 'ReaGate', 'ReaEQ', 'ReaComp'] }),
  switchOff: ['Elgato EQ'],
})

/** Blob parts handed to URL.createObjectURL and the download names clicked. */
let blobs: Blob[] = []
let names: string[] = []

beforeAll(async () => {
  await i18n.changeLanguage('en')
})
beforeEach(() => {
  blobs = []
  names = []
  URL.createObjectURL = vi.fn((b: Blob) => {
    blobs.push(b)
    return `blob:${blobs.length}`
  })
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    names.push(this.download)
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const renderDialog = () =>
  render(
    <ThemeProvider theme={theme}>
      <WaveLinkApplyDialog open onClose={() => undefined} buildPlan={plan} />
    </ThemeProvider>,
  )

const upload = (dialog: HTMLElement, text: string): void => {
  const input = within(dialog).getByLabelText('Upload your Wave Link file') as HTMLInputElement
  fireEvent.change(input, { target: { files: [new File([text], 'Settings.json', { type: 'application/json' })] } })
}

describe('WaveLinkApplyDialog', () => {
  it('upload → preview lists the changes and missing plugins → one click downloads two files', async () => {
    renderDialog()
    const dialog = screen.getByRole('dialog', { name: 'Apply to Wave Link' })
    expect(within(dialog).getByText(/Packages/)).toBeTruthy()
    const next = within(dialog).getByRole('button', { name: 'Next' }) as HTMLButtonElement
    expect(next.disabled).toBe(true)

    const original = settingsText()
    upload(dialog, original)
    await within(dialog).findByText(/Wave Link file read/)
    fireEvent.click(next)

    const list = within(dialog).getByRole('list', { name: 'Changes' })
    const lines = within(list).getAllByRole('listitem').map((li) => li.textContent)
    expect(lines).toContain('Turn off: Elgato EQ')
    expect(lines).toContain('ReaComp Threshold (dB): -20 → -34')
    expect(within(dialog).getByText('Add ReaFIR in Wave Link first, then upload again.')).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Next' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Download both files' }))
    expect(names[0]).toBe('Settings.json')
    expect(names[1]).toMatch(/^Settings\.before-\d{4}-\d{2}-\d{2}-\d{4}\.json$/)
    expect(blobs).toHaveLength(2)
    const [adjusted, backup] = await Promise.all(blobs.map((b) => b.text()))
    expect(backup).toBe(original)
    expect(adjusted).not.toBe(original)
    expect(adjusted.includes('\r\n')).toBe(true)
    expect(within(dialog).getByText(/Quit Wave Link/)).toBeTruthy()
  })

  it('shows a plain error for a file that is not Wave Link settings', async () => {
    renderDialog()
    const dialog = screen.getByRole('dialog')
    upload(dialog, '{"hello": 1}')
    await waitFor(() => expect(within(dialog).getByText(/doesn't look like Wave Link's Settings.json/)).toBeTruthy())
    expect((within(dialog).getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('names the backup with the local date and time', () => {
    expect(backupName(new Date(2026, 10, 9, 7, 5))).toBe('Settings.before-2026-11-09-0705.json')
  })
})
