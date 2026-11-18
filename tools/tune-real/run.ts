// Runs "Tune from a recording" on the person's REAL Wave Link chain with a recorded take, without the app:
// the TS tuner (src/desktop/tune) drives the headless render session (desktop/src-tauri/examples/render_cli.rs).
//
// The goal sets are in SETS (default, complaints, amounts); --only runs one.
//
//   cargo build --release --example render_cli            (in desktop/src-tauri)
//   npx tsx tools/tune-real/run.ts --settings <COPY of Settings.json> --out <dir> [--take _test/control-2-cm-raw.wav]
//                                  [--exe <render_cli.exe>] [--only <goal set name>] [--nr-on]
//
// --nr-on: switch on every plugin Wave Link lists as on whose stored state leaves it on its own bypass (Elgato Noise
// Removal), as the live screen's On switch would, before the tuner reads the chain (render session only, nothing saved).
//
// Settings.json is only read, and only from the copy given (render_cli gets it as VCB_WAVELINK_SETTINGS); the real
// file is refused. Writes to --out: the baseline render and each goal set's final render as 16-bit WAVs (clamped for
// listening) and report.md (per goal set: renders, wall time, changes with their measured effect, before/after,
// unmet, listen-by-numbers checks, the tuner's log).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { OVER_SWITCH_WARN, PEAK_WARN_DB } from '../../src/audio/diagnose'
import { CHOPPED_ZERO } from '../../src/plain/refine'
import { chainWith, openTuneSession } from '../../src/desktop/tune/renderer'
import { ownBypassOn } from '../../src/desktop/slots'
import { CHOP_OK_DB } from '../../src/desktop/tune/score'
import { BAND_KEYS, targetsOf } from '../../src/desktop/tune/targets'
import { tune } from '../../src/desktop/tune/tune'
import { engineChanges, type TakeSummary, type TuneGoals, type TuneResult } from '../../src/desktop/tune/types'
import type { ChainSlot } from '../../src/desktop/advice/types'
import { cliBridge } from './cliBridge'
import { decodeWav, encodeWav16, resample } from './wav'

const SR = 48000
const args = process.argv.slice(2)
const opt = (name: string, dflt?: string): string | undefined => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : dflt
}
const root = resolve(import.meta.dirname, '../..')
const settings = opt('--settings')
const out = opt('--out')
const takePath = resolve(opt('--take', join(root, '_test/control-2-cm-raw.wav')) as string)
const exe = resolve(opt('--exe', join(root, 'desktop/src-tauri/target/release/examples/render_cli.exe')) as string)
const only = opt('--only')
if (!settings || !out) throw new Error('--settings <copy of Settings.json> and --out <dir> are required')
const real = join(process.env.LOCALAPPDATA ?? '', 'Packages/Elgato.WaveLink_g54w8ztgkx496/LocalState/Settings.json')
if (resolve(settings).toLowerCase() === resolve(real).toLowerCase()) throw new Error('pass a COPY of Settings.json, never the real one')
if (!existsSync(exe)) throw new Error(`${exe} not found: cargo build --release --example render_cli`)
mkdirSync(out, { recursive: true })

const SETS: [string, TuneGoals][] = [
  ['default', { use: 'streaming', style: 'natural', bothers: [], amount: 'medium' }],
  ['boomy-roomnoise', { use: 'streaming', style: 'natural', bothers: ['boomy', 'roomNoise'], amount: 'medium' }],
  ['tooquiet-uneven', { use: 'streaming', style: 'natural', bothers: ['tooQuiet', 'unevenVolume'], amount: 'medium' }],
  ['roomnoise-strong', { use: 'streaming', style: 'natural', bothers: ['roomNoise'], amount: 'strong' }],
  ['light', { use: 'streaming', style: 'natural', bothers: [], amount: 'light' }],
  ['clarity-presence', { use: 'streaming', style: 'natural', bothers: ['lacksClarity', 'lacksPresence'], amount: 'medium' }],
  ['nasal-boxy-body', { use: 'streaming', style: 'natural', bothers: ['nasal', 'boxy', 'lacksBody'], amount: 'medium' }],
]

const f = (v: number, d = 1): string => (Number.isFinite(v) ? v.toFixed(d) : String(v))
const summary = (s: TakeSummary): string =>
  `speech ${f(s.speechDb)} · peak ${f(s.peakDb)} (clipped ${s.clipped}) · pauses ${f(s.pauseDb)} · SNR ${f(s.snrDb)} · spread ${f(s.spreadDb)} · dead ${f(100 * s.deadSilence)} % / ${f(s.gateSwitches)} per 10 s · word loss ${f(s.wordLossDb)} · speech cut ${f(100 * s.cutSpeech)} % / ${f(s.cutEvents)} per 10 s · score ${f(s.score.total)} (L ${f(s.score.level)} N ${f(s.score.noise)} T ${f(s.score.tone)} C ${f(s.score.consistency)} D ${f(s.score.damage)})`
const toneLine = (s: TakeSummary): string => s.tone.map((d, i) => `${BAND_KEYS[i]} ${f(d)}`).join(' · ')

function checks(r: TuneResult): string[] {
  const t = targetsOf(r.goals, r.limit)
  const a = r.after
  const unmet = r.unmet.map((u) => u.key)
  const out: string[] = []
  const mark = (ok: boolean, text: string): void => void out.push(`${ok ? 'OK  ' : 'FAIL'} ${text}`)
  mark(a.peakDb <= PEAK_WARN_DB, `peak ${f(a.peakDb)} dBFS ≤ ${PEAK_WARN_DB}`)
  const off = a.speechDb - t.speechDb
  mark(Math.abs(off) <= 1.5 || unmet.some((k) => k.includes('.level.')), `speech ${f(a.speechDb)} vs target ${t.speechDb} (${f(off)} dB)${Math.abs(off) > 1.5 ? ' — unmet says why' : ''}`)
  const dead = a.deadSilence > CHOPPED_ZERO || a.gateSwitches > OVER_SWITCH_WARN
  mark(!dead || t.allowDeadSilence, `dead silence ${f(100 * a.deadSilence)} %, ${f(a.gateSwitches)} cut-outs per 10 s${t.allowDeadSilence ? ' (allowed)' : ''}`)
  mark(a.wordLossDb <= CHOP_OK_DB, `word loss ${f(a.wordLossDb)} dB ≤ ${CHOP_OK_DB}`)
  return out
}

function report(name: string, r: TuneResult, chain: readonly ChainSlot[], wallMs: number, runMs: number): string {
  const slotName = (i: number): string => chain.find((s) => s.index === i)?.name.replace(' (ReaPlugs Edition)', '') ?? `slot ${i}`
  const lines = [
    `## ${name}`,
    '',
    `Goals: ${JSON.stringify(r.goals)}${r.limit < 1 ? ` · limit ${r.limit}` : ''}`,
    '',
    `Renders: ${r.renders} · wall ${f(wallMs / 1000, 2)} s (plugins ${f(runMs / 1000, 2)} s)`,
    '',
    `- before: ${summary(r.before)}`,
    `  - tone: ${toneLine(r.before)}`,
    `- after: ${summary(r.after)}`,
    `  - tone: ${toneLine(r.after)}`,
    ...chainWith(chain, r.changes).filter((c) => c.kind === 'reagate').map((g) => `  - gate [${g.index}] ${g.on ? '' : '(off) '}threshold ${f(g.values.thresholdDb)} dB · hold ${f(g.values.holdMs, 0)} ms · release ${f(g.values.releaseMs, 0)} ms · Wet ${f(g.values.wetDb)} · Dry ${f(g.values.dryDb)}`),
    '',
    '| stage | change | for | measured |',
    '|---|---|---|---|',
    ...r.changes.map((c) => `| ${c.stage} | ${slotName(c.slot)} ${engineChanges([c]).map((x) => (x.kind === 'switch' ? (x.on ? 'ON' : 'OFF') : `${x.key} ${f(x.from, 2)} → ${f(x.to, 2)}`)).join(', ')} | ${c.titleMsg.key.replace('desktop.autotune.reason.', '')} | ${c.effect.metric}${c.effect.band === undefined ? '' : ` (${BAND_KEYS[c.effect.band]})`} ${f(c.effect.before)} → ${f(c.effect.after)} |`),
    ...(r.changes.length ? [] : ['| — | no change | | |']),
    '',
    `Unmet: ${r.unmet.length ? r.unmet.map((u) => `${u.key.replace('desktop.autotune.unmet.', '')} ${u.params ? JSON.stringify(u.params) : ''}`).join(' · ') : 'none'}`,
    '',
    'Listen by numbers:',
    ...checks(r).map((c) => `- ${c}`),
    '',
    '<details><summary>log</summary>',
    '',
    ...r.log.map((l) => `- [${l.stage}] ${l.event}: ${l.text}${l.score ? ` (score ${f(l.score.total)}: L ${f(l.score.level)} N ${f(l.score.noise)} T ${f(l.score.tone)} C ${f(l.score.consistency)} D ${f(l.score.damage)})` : ''}`),
    '',
    '</details>',
    '',
  ]
  return lines.join('\n')
}

async function main(): Promise<void> {
  const wav = decodeWav(readFileSync(takePath))
  const take = resample(wav.samples, wav.sampleRate, SR)
  const bridge = cliBridge(exe, resolve(settings as string))
  if (args.includes('--nr-on')) {
    const open = bridge.renderOpen
    bridge.renderOpen = async () => {
      const st = await open()
      let slots = st.slots
      for (const x of st.slots.filter((y) => !y.bypassed && ownBypassOn(y))) {
        const r = await bridge.renderSetBypass(x.index, false)
        slots = slots.map((y) => (y.index === r.index ? r : y))
      }
      return { ...st, slots }
    }
  }
  const t0 = performance.now()
  const session = await openTuneSession(bridge, take)
  const openMs = performance.now() - t0
  const md: string[] = [
    `# Tune on the real chain`,
    '',
    `Take: ${takePath} (${f(take.length / SR)} s${wav.sampleRate !== SR ? `, resampled from ${wav.sampleRate} Hz` : ''}) · session opened in ${f(openMs / 1000, 2)} s${args.includes('--nr-on') ? ' · --nr-on: plugins on their own bypass switched on' : ''}`,
    '',
    'Chain (Wave Link order):',
    ...session.chain.map((s) => `- [${s.index}] ${s.name} (${s.kind}, ${s.on ? 'on' : 'off'}) ${Object.keys(s.values).length && s.kind !== 'reaeq' ? JSON.stringify(Object.fromEntries(Object.entries(s.values).map(([k, v]) => [k, +v.toFixed(2)]))) : ''}`),
    '',
  ]
  console.log(md.join('\n'))
  const base = await session.render([])
  writeFileSync(join(out as string, 'baseline.wav'), encodeWav16(base, SR))
  try {
    for (const [name, goals] of SETS) {
      if (only && name !== only) continue
      bridge.runMs = 0
      const t1 = performance.now()
      const r = await tune({ take, sampleRate: SR, goals, chain: session.chain, render: session.render })
      const wall = performance.now() - t1
      writeFileSync(join(out as string, `${name}-after.wav`), encodeWav16(r.processed, SR))
      const exported = await session.exportChanges(r.changes)
      const text = `${report(name, r, session.chain, wall, bridge.runMs)}Save would write ${exported.length} Wave Link change(s): ${exported.map((c) => `slot ${c.index}${c.parameterState ? ' state' : ''}${c.bypassed !== undefined ? ` bypass ${c.bypassed}` : ''}`).join(', ') || 'none'}\n`
      md.push(text)
      console.log(text)
      writeFileSync(join(out as string, 'report.md'), md.join('\n'))
    }
  } finally {
    await session.close()
    await bridge.quit()
  }
}

await main()
