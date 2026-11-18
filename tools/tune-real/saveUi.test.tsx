// "Tune from a recording" through the REAL screen (DesktopScreen, its hooks, the real tuner and openTuneSession) with
// the render and Wave Link commands going to render_cli on a COPY of Settings.json: WAV file → goals → tune → Save →
// confirm, then the copy is checked. Not in the default suite (needs the real plugins); run it with
//
//   VCB_SAVE_COPY=<copy of Settings.json> npx vitest run --config tools/tune-real/vitest.config.ts
//
// [--take via VCB_SAVE_TAKE, default _test/control-2-cm-raw.wav]. render_cli refuses Wave Link's own file.
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import i18n from '../../src/i18n'
import en from '../../src/i18n/locales/en/desktop.json'
import { desktopBridge, type DesktopBridge } from '../../src/desktop/bridge'
import type { WlChainChange } from '../../src/desktop/types'
import { theme } from '../../src/theme'
import { DesktopScreen } from '../../src/components/desktop/DesktopScreen'
import { installFakeAudio, type FakeAudio } from '../../src/components/desktop/autotune/testAudio'
import { cliBridge, type CliBridge } from './cliBridge'

const root = resolve(import.meta.dirname, '../..')
const copy = process.env.VCB_SAVE_COPY
const takePath = resolve(process.env.VCB_SAVE_TAKE ?? join(root, '_test/control-2-cm-raw.wav'))
const exe = join(root, 'desktop/src-tauri/target/release/examples/render_cli.exe')
const U = en.desktop.autotune.ui

let cli: CliBridge
let audio: FakeAudio
beforeAll(async () => {
  if (!copy || /Elgato\.WaveLink_/i.test(resolve(copy))) throw new Error('VCB_SAVE_COPY must point at a COPY of Settings.json')
  await i18n.changeLanguage('en')
  cli = cliBridge(exe, resolve(copy))
  audio = installFakeAudio()
})
afterAll(async () => {
  cleanup()
  audio.uninstall()
  await cli.quit()
})

it('saves the tuned result into the Settings.json copy', async () => {
  const exported: WlChainChange[][] = []
  const bridge: DesktopBridge = {
    ...desktopBridge,
    engineInfo: async () => ({ appVersion: 'harness', rustVersion: null, os: 'windows', arch: 'x86_64' }),
    audioDevices: async () => ({ inputs: [], outputs: [], defaultInputId: null, defaultOutputId: null }),
    renderOpen: cli.renderOpen,
    renderSetParam: cli.renderSetParam,
    renderSetBypass: cli.renderSetBypass,
    renderLoadState: cli.renderLoadState,
    renderRun: cli.renderRun,
    renderExportStates: cli.renderExportStates,
    renderClose: cli.renderClose,
    wavelinkRead: cli.wavelinkRead,
    wavelinkPreview: cli.wavelinkPreview,
    wavelinkExport: async (changes, hash, force) => {
      exported.push(changes)
      const r = await cli.wavelinkExport(changes, hash, force)
      console.log(`export: written ${r.written} · steps ${r.steps.join(',')} · backup ${r.backupPath ?? 'none'}`)
      return r
    },
  }
  render(
    <ThemeProvider theme={theme}>
      <DesktopScreen bridge={bridge} />
    </ThemeProvider>,
  )
  const before = readFileSync(copy as string, 'utf8')
  const input = await screen.findByTestId('autotune-wav')
  fireEvent.change(input, { target: { files: [new File([readFileSync(takePath)], 'take.wav')] } })
  await waitFor(() => expect(screen.queryByRole('heading', { name: U.goals.title }) ?? screen.queryByTestId('autotune-record-problem')).toBeTruthy(), { timeout: 20000 })
  const problem = screen.queryByTestId('autotune-record-problem')
  if (problem) throw new Error(`take refused: ${problem.textContent}`)
  fireEvent.click(screen.getByRole('button', { name: U.goals.tune }))
  await screen.findByRole('heading', { name: U.result.title }, { timeout: 300000 })
  fireEvent.click(screen.getByRole('button', { name: U.result.save }))
  const dialog = await screen.findByRole('dialog')
  await waitFor(() => expect(within(dialog).queryByText(en.desktop.save.loading)).toBeNull(), { timeout: 60000 })
  console.log(`dialog before confirm: ${dialog.textContent}`)
  fireEvent.click(within(dialog).getByRole('button', { name: en.desktop.save.confirm }))
  await waitFor(() => expect(within(dialog).queryByText(en.desktop.save.saving)).toBeNull(), { timeout: 60000 })
  console.log(`dialog after confirm: ${dialog.textContent}`)
  fireEvent.click(within(dialog).getByRole('button', { name: en.desktop.save.close }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  console.log(`result step says saved: ${screen.queryByTestId('autotune-saved')?.textContent ?? 'no'}`)
  const after = readFileSync(copy as string, 'utf8')
  console.log(`copy ${after === before ? 'UNCHANGED' : 'changed'} · exports ${exported.length} with ${exported.map((c) => c.length).join(',')} change(s)`)
  expect(after).not.toBe(before)
}, 600000)
