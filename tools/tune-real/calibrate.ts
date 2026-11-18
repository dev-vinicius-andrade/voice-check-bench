// Runs "Calibrate noise" (src/desktop/calibrate) on the person's REAL Wave Link chain with a recorded take, as if live:
// the headless live engine (desktop/src-tauri/examples/live_cli.rs: the engine's Pipeline, fed at real-time pace so
// Elgato plugins follow on the clock) gets the take 100 ms at a time, and the calibrator's changes reach the plugins
// between frames through the live screen's own code (chainModel batchOn → engineOp), as the app sends them.
//
//   cargo build --release --example live_cli            (in desktop/src-tauri)
//   npx tsx tools/tune-real/calibrate.ts --settings <COPY of Settings.json> --out <dir> [--take _test/control-2-cm-raw.wav]
//                                        [--exe <live_cli.exe>] [--amount light|medium|strong] [--nudges] [--quiet <from>,<to>]
//                                        [--preset <slot>:<key>=<value>,…]
//
// The person is played by the take: while the calibration asks for quiet, the room of its quiet lead (0.6–2.7 s, the
// tuner's pause frames there, played forward and backward so it never clicks); while it asks for talking, its speech
// from 3 s on (looping). --nudges: after the result, More reduction, then Less reduction, each checked on the next
// talking. Settings.json is only read, from the copy given (VCB_WAVELINK_SETTINGS); the real file is refused. Writes to
// --out: raw.wav and heard.wav (the processed stream, clamped for listening) and report.md.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { QUIET_SEC } from '../../src/audio/reference'
import { batchOn, modelOf, withSlot, type AppliedRow, type BatchOp, type ChainModel } from '../../src/components/desktop/tuning/chainModel'
import type { ProcessingAmount } from '../../src/desktop/advice/prefs'
import { NoiseCalibrator } from '../../src/desktop/calibrate/calibrator'
import type { CalCommand, CalView } from '../../src/desktop/calibrate/types'
import { asListed, exportPlan } from '../../src/desktop/exportPlan'
import { inputOf } from '../../src/desktop/tune/renderer'
import { engineOp, playedChain, type EngineOp } from '../../src/desktop/slots'
import { withChange } from '../../src/desktop/advice/chain'
import type { AudioExportedState, AudioSlot, AudioStatus, WlSnapshot } from '../../src/desktop/types'
import en from '../../src/i18n/locales/en/desktop.json'
import type { Msg } from '../../src/plain/types'
import { decodeWav, encodeWav16, resample } from './wav'

const SR = 48000
const FRAME = 4800
const args = process.argv.slice(2)
const opt = (name: string, dflt?: string): string | undefined => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : dflt
}
const root = resolve(import.meta.dirname, '../..')
const settings = opt('--settings')
const out = opt('--out')
const takePath = resolve(opt('--take', join(root, '_test/control-2-cm-raw.wav')) as string)
const exe = resolve(opt('--exe', join(root, 'desktop/src-tauri/target/release/examples/live_cli.exe')) as string)
const amount = (opt('--amount', 'medium') ?? 'medium') as ProcessingAmount
if (!settings || !out) throw new Error('--settings <copy of Settings.json> and --out <dir> are required')
const real = join(process.env.LOCALAPPDATA ?? '', 'Packages/Elgato.WaveLink_g54w8ztgkx496/LocalState/Settings.json')
if (resolve(settings).toLowerCase() === resolve(real).toLowerCase()) throw new Error('pass a COPY of Settings.json, never the real one')
if (!existsSync(exe)) throw new Error(`${exe} not found: cargo build --release --example live_cli`)
mkdirSync(out, { recursive: true })

/** live_cli over line-delimited JSON. */
function liveCli() {
  const child = spawn(exe, [], { env: { ...process.env, VCB_WAVELINK_SETTINGS: resolve(settings as string) }, stdio: ['pipe', 'pipe', 'pipe'] })
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>()
  let next = 1
  child.stderr.on('data', (d: Buffer) => process.stderr.write(`[live_cli] ${d.toString()}`))
  createInterface({ input: child.stdout }).on('line', (line) => {
    let msg: { id?: unknown; ok?: unknown; error?: unknown }
    try {
      msg = JSON.parse(line) as typeof msg
    } catch {
      return
    }
    const p = typeof msg.id === 'number' ? pending.get(msg.id) : undefined
    if (!p) return
    pending.delete(msg.id as number)
    if (msg.error !== undefined) p.reject(msg.error)
    else p.resolve(msg.ok)
  })
  const call = <T>(cmd: string, a: Record<string, unknown> = {}): Promise<T> =>
    new Promise<T>((res, rej) => {
      const id = next++
      pending.set(id, { resolve: res as (v: unknown) => void, reject: rej })
      child.stdin.write(`${JSON.stringify({ cmd, ...a, id })}\n`)
    })
  return { call }
}

/** The person: the take's room while asked for quiet (--quiet <from>,<to> seconds), its speech while asked to talk. */
function person(take: Float32Array) {
  const [qa, qb] = (opt('--quiet', `0.6,${QUIET_SEC - 0.3}`) ?? '').split(',').map(Number)
  const quiet = take.subarray(Math.round(qa * SR), Math.round(qb * SR))
  const speech = take.subarray(Math.round(QUIET_SEC * SR))
  let qi = 0
  let si = 0
  return (talking: boolean): Float32Array => {
    const x = new Float32Array(FRAME)
    for (let k = 0; k < FRAME; k++) {
      if (talking) x[k] = speech[si++ % speech.length]
      else {
        const L = quiet.length
        const pos = qi++ % (2 * L)
        x[k] = quiet[pos < L ? pos : 2 * L - 1 - pos]
      }
    }
    return x
  }
}

const label = (m: Msg): string => {
  let node: unknown = en
  for (const part of m.key.split('.')) node = node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined
  const text = typeof node === 'string' ? node : m.key
  return text.replace(/\{\{\s*(\w+)[^}]*\}\}/g, (_, k: string) => {
    const v = m.params?.[k]
    return typeof v === 'number' ? String(Math.round(v * 10) / 10) : String(v ?? '')
  })
}
const f = (v: number, d = 1): string => (Number.isFinite(v) ? v.toFixed(d) : String(v))

async function main(): Promise<void> {
  const wav = decodeWav(readFileSync(takePath))
  const take = resample(wav.samples, wav.sampleRate, SR)
  const cli = liveCli()
  const dir = mkdtempSync(join(tmpdir(), 'vcb-live-'))
  const inFile = join(dir, 'in.f32')
  const outFile = join(dir, 'out.f32')
  const opened = await cli.call<{ sampleRate: number; latencySamples: number; slots: AudioSlot[] }>('open')
  const snap = await cli.call<WlSnapshot>('wavelink_read')
  const input = inputOf(snap, opened.slots)
  if (!input) throw new Error('Settings.json does not describe the chain live_cli opened')
  // --preset <slot>:<key>=<value>,…: values set before the calibration starts (as if changed on the live screen first)
  const presets = (opt('--preset') ?? '').split(',').filter(Boolean)
  for (const p of presets) {
    const m = /^(\d+):(\w+)=(-?[\d.]+)$/.exec(p)
    if (!m) throw new Error(`--preset ${p}: <slot>:<key>=<value>`)
    const slot = Number(m[1])
    const chain0 = playedChain(opened.slots, input.entries)
    const from = chain0.find((c) => c.index === slot)?.values[m[2]] ?? NaN
    const change = { id: 'preset', reason: 'tone' as const, titleMsg: { key: 'x' }, kind: 'value' as const, slot, key: m[2], from, to: Number(m[3]) }
    // `on` switches the slot (and the plugin's own bypass) as the effect card's On switch does
    const op = m[2] === 'on' ? { op: 'bypass' as const, slot, bypassed: Number(m[3]) === 0 } : engineOp(change, withChange(chain0, change), opened.slots, input.entries)
    if (op?.op !== 'param' && op?.op !== 'bypass') throw new Error(`--preset ${p}: not a plugin parameter or switch`)
    const r = op.op === 'param' ? await cli.call<AudioSlot>('set_param', { slot, param: op.id, value: op.value }) : await cli.call<AudioSlot>('set_bypass', { slot, bypassed: op.bypassed })
    opened.slots = opened.slots.map((x) => (x.index === r.index ? r : x))
  }
  const status = { source: { settingsPath: snap.path, inputKey: input.key, inputLabel: input.label }, slots: opened.slots } as unknown as AudioStatus
  let model: ChainModel = modelOf(status, snap)
  let applied: AppliedRow[] = []
  const ids = new Map<string, string>()
  const md: string[] = [
    '# Calibrate noise on the real chain (headless, as if live)',
    '',
    `Take: ${takePath} (${f(take.length / SR)} s) · amount ${amount} · chain latency ${opened.latencySamples} samples${presets.length ? ` · preset ${presets.join(', ')}` : ''}`,
    '',
    'Chain as the live screen plays it (own-bypassed plugins off):',
    ...model.undo.chain.map((s) => `- [${s.index}] ${s.name} (${s.kind}, ${s.on ? 'on' : 'off'}) ${s.kind === 'reaeq' ? '' : JSON.stringify(Object.fromEntries(Object.entries(s.values).map(([k, v]) => [k, +v.toFixed(2)])))}`),
    '',
    'Timeline (stream time):',
  ]
  let clockMs = 0
  const send = async (op: EngineOp): Promise<void> => {
    const r =
      op.op === 'param'
        ? await cli.call<AudioSlot>('set_param', { slot: op.slot, param: op.id, value: op.value })
        : op.op === 'state'
          ? await cli.call<AudioSlot>('load_state', { slot: op.slot, parameterState: op.parameterState })
          : await cli.call<AudioSlot>('set_bypass', { slot: op.slot, bypassed: op.bypassed })
    model = withSlot(model, r) ?? model
  }
  /** As useNoiseCalibration + useChainState: one batch, the engine commands in order. */
  const apply = async (cmds: readonly CalCommand[]): Promise<void> => {
    if (!cmds.length) return
    const batch: BatchOp[] = []
    const targets: (string | null)[] = []
    for (const c of cmds) {
      const id = ids.get(c.target)
      if (c.kind === 'revert') {
        ids.delete(c.target)
        if (id !== undefined) {
          batch.push({ op: 'undo', appliedId: id })
          targets.push(null)
        }
      } else {
        batch.push(id !== undefined && c.change.kind === 'value' ? { op: 'retarget', appliedId: id, advice: c.change } : { op: 'apply', advice: c.change })
        targets.push(c.target)
      }
      md.push(`- ${f(clockMs / 1000)} s: ${c.kind === 'set' ? label(c.change.changeMsg) : `revert ${c.target}`}`)
    }
    const r = batchOn(model, applied, batch)
    model = r.model
    applied = r.applied
    r.ids.forEach((id, k) => {
      const t = targets[k]
      if (t !== null && id !== null) ids.set(t, id)
    })
    for (const op of r.ops) await send(op)
  }

  const cal = new NoiseCalibrator()
  const next = person(take)
  const raws: Float32Array[] = []
  const heard: Float32Array[] = []
  let phase = ''
  let seq = 0
  let latency = opened.latencySamples
  const frame = async (talking: boolean): Promise<CalView> => {
    const raw = next(talking)
    writeFileSync(inFile, new Uint8Array(raw.buffer))
    const r = await cli.call<{ samples: number; settled: boolean; latencySamples: number }>('stream', { input: inFile, output: outFile, pace: true })
    const bytes = readFileSync(outFile)
    const both = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + 2 * r.samples * 4))
    const aligned = both.slice(0, r.samples)
    const processed = both.slice(r.samples)
    raws.push(aligned)
    heard.push(processed)
    const moved = r.latencySamples !== latency
    latency = r.latencySamples
    clockMs += (r.samples / SR) * 1000
    await apply(cal.push({ seq: seq++, sampleRate: SR, settled: r.settled, latencyChanged: moved, counters: { streamDropped: 0, inputOverruns: 0 }, raw: aligned, processed }))
    const v = cal.view
    const tag = `${v.phase}${v.notice ? ` (${v.notice.key.split('.').pop()})` : ''}`
    if (tag !== phase) {
      phase = tag
      md.push(`- ${f(clockMs / 1000)} s: phase ${tag}`)
    }
    return v
  }
  /** Frames until the calibration is done (the person does what it asks), then `tail` seconds of quiet. */
  const until = async (tail = 3): Promise<CalView> => {
    let v = cal.view
    for (let k = 0; k < 1800 && v.phase !== 'done'; k++) v = await frame(v.phase === 'talk' || v.phase === 'verify')
    for (let k = 0; k < tail * 10; k++) v = await frame(false)
    return v
  }
  const result = (title: string, v: CalView): void => {
    const s = v.summary
    md.push('', `## ${title}`, '')
    if (!s) return void md.push('no result')
    md.push(
      `- room on the raw mic ${f(s.roomDb)} dBFS · pauses as heard ${f(s.beforeDb)} → ${f(s.afterDb)} dBFS${s.silent ? ' (silent)' : ''}`,
      `- talk check: speech cut ${f(100 * s.cutShare, 2)} % · ${f(s.cutEvents, 2)} cuts per 10 s · room pumping ${f(s.pumpDb)} dB`,
      `- changes: ${s.changes.map(label).join(' · ') || 'none'}`,
      `- notes: ${s.notes.map(label).join(' · ') || 'none'}`,
      `- chain now: ${model.undo.chain.filter((c) => c.kind !== 'builtin').map((c) => `${c.kind}${c.on ? '' : ' off'}${c.kind === 'noiseRemoval' ? ` ${f(c.values.strength, 0)}` : ''}${c.kind === 'reagate' ? ` thr ${f(c.values.thresholdDb)} dry ${f(c.values.dryDb)}` : ''}`).join(' → ')}`,
    )
  }
  try {
    await apply(cal.start(model.undo.chain, amount))
    const t0 = performance.now()
    const v = await until()
    result(`Result (${f((performance.now() - t0) / 1000)} s wall)`, v)
    if (model.entries && model.inputKey) {
      const exported = await cli.call<AudioExportedState[]>('export_states')
      const l = asListed(model.start, model.undo.chain, model.ownBypassed)
      const plan = exportPlan(model.inputKey, l.start, l.chain, model.slots, model.entries, exported)
      md.push(`- Save would write: ${plan.changes.map((c) => `slot ${c.index}${c.parameterState ? ' ParameterState' : ''}${c.bypassed !== undefined ? ` BypassState ${c.bypassed}` : ''}`).join(', ') || 'nothing'}${plan.unsaved.length ? ` (unsaved: ${plan.unsaved.join(', ')})` : ''}`)
    }
    md.push('', '<details><summary>calibration log</summary>', '', ...cal.log.map((l) => `- ${l}`), '', '</details>')
    if (args.includes('--nudges')) {
      await apply(cal.more())
      result('After More reduction', await until())
      await apply(cal.less())
      result('After Less reduction', await until())
      md.push('', '<details><summary>calibration log</summary>', '', ...cal.log.map((l) => `- ${l}`), '', '</details>')
    }
  } finally {
    const join2 = (parts: Float32Array[]): Float32Array => {
      const x = new Float32Array(parts.length * FRAME)
      parts.forEach((p, k) => x.set(p, k * FRAME))
      return x
    }
    writeFileSync(join(out as string, 'raw.wav'), encodeWav16(join2(raws), SR))
    writeFileSync(join(out as string, 'heard.wav'), encodeWav16(join2(heard), SR))
    writeFileSync(join(out as string, 'report.md'), `${md.join('\n')}\n`)
    console.log(md.join('\n'))
    await cli.call('quit').catch(() => undefined)
    rmSync(dir, { recursive: true, force: true })
  }
}

void main()
