// "Save to Wave Link" of "Tune from a recording" end to end, without the app and on a COPY of Settings.json: the same
// calls in the same order as the result step (useTuneRun → useTuneSave → useExportFlow): wavelink_read → render_open
// → tune() (or a known change set) → session.exportChanges → wavelink_preview → wavelink_export, then the copy is
// read again and every change is checked in it. render_cli runs export() with a Wave Link that is never running.
//
//   cargo build --release --example render_cli            (in desktop/src-tauri)
//   npx tsx tools/tune-real/save.ts --settings <COPY of Settings.json> [--take _test/control-2-cm-raw.wav]
//                                   [--exe <render_cli.exe>] [--known] [--twice] [--bothers roomNoise,boomy]
//                                   [--amount light|medium|strong] [--retune tooProcessed|<bothers>]
//
// --known: instead of tune(), the change set ReaEQ band 2 gain +1.5 dB, ReaComp Wet +1 dB, ReaFIR off, Elgato Noise
// Removal on (each only when the chain has that plugin). --twice: save a second time afterwards (it must write
// nothing and say so). The copy is changed (backups land next to it); the real file is refused.
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { ChainSlot, Change } from '../../src/desktop/advice/types'
import { openTuneSession } from '../../src/desktop/tune/renderer'
import { retune, tune } from '../../src/desktop/tune/tune'
import type { Bother, TuneGoals } from '../../src/desktop/tune/types'
import type { WlChainChange } from '../../src/desktop/types'
import { cliBridge } from './cliBridge'
import { decodeWav, resample } from './wav'

const SR = 48000
const args = process.argv.slice(2)
const opt = (name: string, dflt?: string): string | undefined => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : dflt
}
const root = resolve(import.meta.dirname, '../..')
const settings = opt('--settings')
const takePath = resolve(opt('--take', join(root, '_test/control-2-cm-raw.wav')) as string)
const exe = resolve(opt('--exe', join(root, 'desktop/src-tauri/target/release/examples/render_cli.exe')) as string)
if (!settings) throw new Error('--settings <copy of Settings.json> is required')
const real = join(process.env.LOCALAPPDATA ?? '', 'Packages/Elgato.WaveLink_g54w8ztgkx496/LocalState/Settings.json')
if (resolve(settings).toLowerCase() === resolve(real).toLowerCase() || /Elgato\.WaveLink_/i.test(resolve(settings))) {
  throw new Error('pass a COPY of Settings.json, never the real one')
}
if (!existsSync(exe)) throw new Error(`${exe} not found: cargo build --release --example render_cli`)

/** The known change set on this chain (only the plugins it has). */
function known(chain: readonly ChainSlot[]): Change[] {
  const base = { reason: 'undo' as const, titleMsg: { key: 'desktop.advice.undo' } }
  const out: Change[] = []
  const eq = chain.find((s) => s.kind === 'reaeq')
  const gain = eq?.values['band2.gainDb']
  if (eq && gain !== undefined) out.push({ ...base, id: 'k:eq', kind: 'value', slot: eq.index, key: 'band2.gainDb', from: gain, to: gain + 1.5 })
  const comp = chain.find((s) => s.kind === 'reacomp')
  const wet = comp?.values.wetDb
  if (comp && wet !== undefined) out.push({ ...base, id: 'k:comp', kind: 'value', slot: comp.index, key: 'wetDb', from: wet, to: wet + 1 })
  const fir = chain.find((s) => /reafir/i.test(s.name) && s.on)
  if (fir) out.push({ ...base, id: 'k:fir', kind: 'switch', slot: fir.index, on: false })
  const nr = chain.find((s) => s.kind === 'noiseRemoval' && !s.on)
  if (nr) out.push({ ...base, id: 'k:nr', kind: 'switch', slot: nr.index, on: true })
  return out
}

type Entry = { ParameterState?: string; BypassState?: boolean }

/** The entry a change targets in `text`, read with JSON.parse (independent of the Rust scanner). */
function entryOf(text: string, c: WlChainChange): Entry | undefined {
  const json = JSON.parse(text) as { MixerConfiguration?: { InputSettings?: Record<string, { AudioPluginConfigurations?: Entry[] }> } }
  return json.MixerConfiguration?.InputSettings?.[c.inputKey]?.AudioPluginConfigurations?.[c.index]
}

function check(text: string, changes: readonly WlChainChange[]): string[] {
  return changes.flatMap((c) => {
    const e = entryOf(text, c)
    if (!e) return [`input ${c.inputKey} effect ${c.index}: not found`]
    const bad: string[] = []
    if (c.parameterState !== undefined && e.ParameterState !== c.parameterState) bad.push(`effect ${c.index}: ParameterState not written`)
    if (c.bypassed !== undefined && e.BypassState !== c.bypassed) bad.push(`effect ${c.index}: BypassState ${String(e.BypassState)} is not ${String(c.bypassed)}`)
    return bad
  })
}

const describe = (cs: readonly WlChainChange[]): string =>
  cs.map((c) => `effect ${c.index}${c.parameterState !== undefined ? ` state(${c.parameterState.length} chars)` : ''}${c.bypassed !== undefined ? ` bypass=${c.bypassed}` : ''}`).join(', ') || 'none'

const changeLine = (c: Change): string => (c.kind === 'switch' ? `[${c.slot}] ${c.on ? 'ON' : 'OFF'}` : `[${c.slot}] ${c.key} ${c.from.toFixed(2)} -> ${c.to.toFixed(2)}`)

async function main(): Promise<void> {
  const wav = decodeWav(readFileSync(takePath))
  const take = resample(wav.samples, wav.sampleRate, SR)
  const path = resolve(settings as string)
  const bridge = cliBridge(exe, path)
  let failed = false
  try {
    // useTuneRun: read first, then open the session
    const snap = await bridge.wavelinkRead()
    const session = await openTuneSession(bridge, take)
    console.log(`chain: ${session.chain.map((s) => `[${s.index}] ${s.name} ${s.on ? 'on' : 'off'}`).join(' · ')}`)
    let changes: readonly Change[]
    if (args.includes('--known')) changes = known(session.chain)
    else {
      const bothers = (opt('--bothers', '') as string).split(',').filter(Boolean) as Bother[]
      const goals: TuneGoals = { use: 'streaming', style: 'natural', bothers, amount: (opt('--amount', 'medium') as TuneGoals['amount']) }
      let r = await tune({ take, sampleRate: SR, goals, chain: session.chain, render: session.render })
      const again = opt('--retune')
      if (again) {
        console.log(`first result: ${r.changes.map(changeLine).join(' · ') || 'none'}`)
        const next = retune(r, again === 'tooProcessed' ? 'tooProcessed' : (again.split(',') as Bother[]))
        r = await tune({ take, sampleRate: SR, chain: session.chain, render: session.render, ...next })
      }
      changes = r.changes
    }
    console.log(`changes: ${changes.map(changeLine).join(' · ') || 'none'}`)
    for (let pass = 1; pass <= (args.includes('--twice') ? 2 : 1); pass++) {
      // useTuneSave.prepare → useExportFlow.open (preview) → confirm (export with the hash read before the session)
      const hash = pass === 1 ? snap.hash : (await bridge.wavelinkRead()).hash
      const wl = await session.exportChanges(changes)
      console.log(`pass ${pass}: exportChanges -> ${wl.length}: ${describe(wl)}`)
      const lines = wl.length ? await bridge.wavelinkPreview(wl) : []
      console.log(`pass ${pass}: preview -> ${lines.length} line(s): ${lines.map((l) => `${l.index} ${l.plugin} ${l.field} ${l.from} -> ${l.to}`).join(' | ')}`)
      const before = readFileSync(path, 'utf8')
      const report = await bridge.wavelinkExport(wl, hash, false)
      const after = readFileSync(path, 'utf8')
      console.log(`pass ${pass}: export -> written ${report.written} · steps ${report.steps.join(',')} · backup ${report.backupPath ?? 'none'} · file ${after === before ? 'UNCHANGED' : 'changed'}`)
      const bad = check(after, wl)
      console.log(bad.length ? `pass ${pass}: FAIL ${bad.join('; ')}` : `pass ${pass}: OK every change is in the copy`)
      if (bad.length || (pass === 1 && wl.length > 0 && !report.written)) failed = true
    }
    await session.close()
  } catch (e) {
    failed = true
    console.log(`FAIL ${e instanceof Error ? e.message : JSON.stringify(e)}`)
  } finally {
    await bridge.quit()
  }
  process.exitCode = failed ? 1 : 0
}

await main()
