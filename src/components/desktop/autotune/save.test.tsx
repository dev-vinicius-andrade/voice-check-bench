import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import i18n from '../../../i18n'
import en from '../../../i18n/locales/en/desktop.json'
import { desktopBridge, type DesktopBridge } from '../../../desktop/bridge'
import { INPUT_KEY, snapshot } from '../../../desktop/testChain'
import type { TuneChange, TuneResult } from '../../../desktop/tune'
import { testTake } from '../../../desktop/tune/testTake'
import type { WlChainChange, WlFlowReport, WlSnapshot } from '../../../desktop/types'
import { theme } from '../../../theme'
import { ResultStep } from './ResultStep'
import type { TuneRun } from './useTuneRun'
import { saveOutcome, useTuneSave } from './useTuneSave'

const U = en.desktop.autotune.ui
const S = en.desktop.save
const TAKE = testTake({ quietSec: 3, speechSec: 12 })
const summary: TuneResult['before'] = {
  speechDb: -21, peakDb: -8, clipped: 0, pauseDb: -70, snrDb: 49, tone: [0, 0, 0, 0, 0, 0, 0, 0, 0], spreadDb: 9, deadSilence: 0, gateSwitches: 0, wordLossDb: 0, cutSpeech: 0, cutEvents: 0, pumpDb: 0, burstDb: NaN, burstEvents: 0, removerCut: NaN, removerCutEvents: NaN,
  score: { level: 0, noise: 0, tone: 0, consistency: 0, damage: 0, total: 0 },
}
const CHANGE: TuneChange = {
  id: 'tune:2:wetDb', reason: 'tooQuiet', kind: 'value', slot: 2, key: 'wetDb', from: 6, to: 15, stage: 'level',
  titleMsg: { key: 'desktop.autotune.reason.level.up', params: { from: -30, db: 9, target: -21 } },
  changeMsg: { key: 'desktop.advice.change.db', params: { plugin: 'ReaComp', field: 'Wet', from: 6, to: 15 } },
  effect: { metric: 'speechDb', before: -30, after: -21 },
}
const RESULT: TuneResult = { changes: [CHANGE], before: summary, after: summary, processed: TAKE, renders: 6, unmet: [], log: [], goals: { use: 'streaming', style: 'natural', bothers: [], amount: 'medium' }, limit: 1 }
const WL: WlChainChange[] = [{ inputKey: INPUT_KEY, index: 2, parameterState: 'bmV3' }]
const report = (over: Partial<WlFlowReport>): WlFlowReport => ({
  path: 'C:/Settings.json', backupPath: 'C:/Settings.before-2026-11-18-0300.json', extraBackupPath: null, wasRunning: true, forced: false, restarted: true, written: true,
  restoredFrom: null, changes: [], hash: 'h2', steps: ['checked', 'backedUp', 'closed', 'written', 'started', 'verified'], ...over,
})
const UNWRITTEN = report({ backupPath: null, wasRunning: false, restarted: false, written: false, hash: 'h1', steps: ['checked'] })

function Harness({ bridge, snap }: { bridge: DesktopBridge; snap: WlSnapshot }) {
  const run: TuneRun = { state: { step: 'done', result: RESULT }, snapshot: snap, exportChanges: async () => WL, run: async () => undefined, adjust: async () => undefined, cancel: () => undefined }
  const save = useTuneSave(bridge, run, RESULT)
  return <ResultStep take={TAKE} result={RESULT} save={save} onAdjust={() => undefined} onRecordAgain={() => undefined} />
}

function view(exportImpl: DesktopBridge['wavelinkExport'], snap = snapshot()) {
  const bridge: DesktopBridge = {
    ...desktopBridge,
    wavelinkPreview: vi.fn(async (c: WlChainChange[]) => c.map((x) => ({ inputKey: x.inputKey, input: 'Wave XLR', index: x.index, plugin: 'ReaComp (ReaPlugs Edition)', field: 'parameterState' as const, from: 'a', to: 'b' }))),
    wavelinkExport: vi.fn(exportImpl),
  }
  render(
    <ThemeProvider theme={theme}>
      <Harness bridge={bridge} snap={snap} />
    </ThemeProvider>,
  )
  return bridge
}

/** Save → confirm in the dialog; resolves with the dialog once the export finished. */
async function saveAndConfirm(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole('button', { name: U.result.save }))
  const dialog = await screen.findByRole('dialog')
  await within(dialog).findByTestId('tune-save-lines')
  fireEvent.click(within(dialog).getByRole('button', { name: S.confirm }))
  await waitFor(() => expect(within(dialog).queryByText(S.saving)).toBeNull())
  return dialog
}

beforeAll(() => i18n.changeLanguage('en'))
afterEach(cleanup)

describe('saveOutcome', () => {
  it('is saved only when the file was written and verified', () => {
    expect(saveOutcome(report({}))).toBe('saved')
    expect(saveOutcome(UNWRITTEN)).toBe('unchanged')
    expect(saveOutcome(report({ steps: ['checked', 'backedUp', 'written'] }))).toBeNull()
  })
})

describe('Save on the result step says what happened to the file', () => {
  it('written and verified: "Saved", and Save is done', async () => {
    const bridge = view(async () => report({}))
    const dialog = await saveAndConfirm()
    expect(bridge.wavelinkExport).toHaveBeenCalledWith(WL, 'h1', false)
    expect(within(dialog).getByTestId('tune-flow-outcome').textContent).toBe(S.done)
    fireEvent.click(within(dialog).getByRole('button', { name: S.close }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByTestId('autotune-saved').textContent).toContain(U.result.saved)
    expect(screen.getByRole('button', { name: U.result.save })).toHaveProperty('disabled', true)
  })

  it('nothing written: says so plainly, never "Saved"', async () => {
    view(async () => UNWRITTEN)
    const dialog = await saveAndConfirm()
    const outcome = within(dialog).getByTestId('tune-flow-outcome')
    expect(outcome.textContent).toBe(S.unchanged)
    expect(outcome.className).toContain('MuiAlert-colorInfo')
    expect(within(dialog).queryByText(S.done)).toBeNull()
    expect(screen.queryByTestId('autotune-saved')).toBeNull()
    expect(screen.getByTestId('autotune-unchanged').textContent).toBe(S.unchanged)
  })

  it('the file changed since the recording was tuned: an error in this screen’s words, nothing saved', async () => {
    view(async () => Promise.reject({ code: 'changedMeanwhile', message: 'Settings.json changed since it was read; read it again' }))
    const dialog = await saveAndConfirm()
    expect(within(dialog).getByRole('alert').textContent).toBe(U.result.changedMeanwhile)
    expect(within(dialog).queryByText(en.desktop.errors.changedMeanwhile)).toBeNull()
    expect(screen.queryByTestId('autotune-saved')).toBeNull()
    expect(screen.queryByTestId('autotune-unchanged')).toBeNull()
  })

  it('a write that fails is an error, never "Saved"', async () => {
    view(async () => Promise.reject({ code: 'writeFailed', message: 'cannot write' }))
    const dialog = await saveAndConfirm()
    expect(within(dialog).getByRole('alert').textContent).toBe(en.desktop.errors.writeFailed)
    expect(screen.queryByTestId('autotune-saved')).toBeNull()
  })

  it('without the hash the file was read with, Save is an error instead of doing nothing', async () => {
    const bridge = view(async () => report({}), { ...snapshot(), hash: '' })
    const dialog = await saveAndConfirm()
    expect(bridge.wavelinkExport).not.toHaveBeenCalled()
    expect(within(dialog).getByRole('alert').textContent).toBe(en.desktop.errors.notFound)
    expect(screen.queryByTestId('autotune-saved')).toBeNull()
  })
})
