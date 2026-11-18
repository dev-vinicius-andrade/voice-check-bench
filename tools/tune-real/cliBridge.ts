// A TuneBridge (src/desktop/tune/renderer.ts) over the headless render session
// (desktop/src-tauri/examples/render_cli.rs): line-delimited JSON on its stdin/stdout, samples through temp files.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { DesktopBridge } from '../../src/desktop/bridge'
import type { TuneBridge } from '../../src/desktop/tune/renderer'

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: unknown) => void
}

export interface CliBridge extends TuneBridge, Pick<DesktopBridge, 'wavelinkPreview' | 'wavelinkExport'> {
  /** Wall time the plugins spent in `run`, ms, summed since the last reset. */
  runMs: number
  runs: number
  quit(): Promise<void>
}

/** Starts render_cli with `settings` (a COPY of Wave Link's Settings.json) as its only Settings.json. */
export function cliBridge(exe: string, settings: string): CliBridge {
  const child: ChildProcessWithoutNullStreams = spawn(exe, [], { env: { ...process.env, VCB_WAVELINK_SETTINGS: settings }, stdio: ['pipe', 'pipe', 'pipe'] })
  const pending = new Map<number, Pending>()
  let next = 1
  const dir = mkdtempSync(join(tmpdir(), 'vcb-render-'))
  const inFile = join(dir, 'in.f32')
  const outFile = join(dir, 'out.f32')
  let written: Float32Array | null = null

  child.stderr.on('data', (d: Buffer) => process.stderr.write(`[render_cli] ${d.toString()}`))
  createInterface({ input: child.stdout }).on('line', (line) => {
    let msg: { id?: unknown; ok?: unknown; error?: unknown }
    try {
      msg = JSON.parse(line) as typeof msg
    } catch {
      process.stderr.write(`[render_cli stdout] ${line}\n`)
      return
    }
    const p = typeof msg.id === 'number' ? pending.get(msg.id) : undefined
    if (!p) return
    pending.delete(msg.id as number)
    if (msg.error !== undefined) p.reject(msg.error)
    else p.resolve(msg.ok)
  })
  child.on('exit', (code) => {
    for (const p of pending.values()) p.reject(new Error(`render_cli exited (${code})`))
    pending.clear()
  })

  const call = <T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = next++
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      child.stdin.write(`${JSON.stringify({ cmd, ...args, id })}\n`)
    })

  const bridge: CliBridge = {
    runMs: 0,
    runs: 0,
    renderOpen: () => call('open'),
    renderSetParam: (slot, id, value) => call('set_param', { slot, param: id, value }),
    renderSetBypass: (slot, bypassed) => call('set_bypass', { slot, bypassed }),
    renderLoadState: (slot, parameterState) => call('load_state', { slot, parameterState }),
    renderRun: async (samples) => {
      if (written !== samples) {
        writeFileSync(inFile, new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength))
        written = samples
      }
      const r = await call<{ samples: number; ms: number }>('run', { input: inFile, output: outFile })
      bridge.runMs += r.ms
      bridge.runs++
      const bytes = readFileSync(outFile)
      return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + r.samples * 4))
    },
    renderExportStates: () => call('export_states'),
    renderClose: () => call('close'),
    wavelinkRead: () => call('wavelink_read'),
    // the app's commands with the app's argument names, on the copy only (render_cli refuses the real file)
    wavelinkPreview: (changes) => call('wavelink_preview', { changes }),
    wavelinkExport: (changes, expectedHash, force) => call('wavelink_export', { changes, expectedHash, force }),
    quit: async () => {
      await call('quit').catch(() => undefined)
      rmSync(dir, { recursive: true, force: true })
    },
  }
  return bridge
}
