// The tuner's render on the person's real chain (SPEC "Tune from a recording (desktop)" → Real chain). Framework-free.
// openTuneSession() opens the offline render session (its own plugin instances of the Wave Link mic chain), reads the
// same input's Wave Link entries once, and hands tune() the chain in real units plus a `render` that applies changes
// (values, and slots switched on or off) on top of that chain and renders the take. They go to the plugins through
// the live screen's adapter (../slots.ts engineOp); Save's Wave Link changes come from ../exportPlan.ts with the
// session's own state export.
import { sameValue, withChange } from '../advice/chain'
import type { ChainSlot, Change, ValueChange } from '../advice/types'
import type { DesktopBridge, RenderBridge } from '../bridge'
import { exportPlan } from '../exportPlan'
import { chainOf, engineOp, ownBypassOn, type EngineOp } from '../slots'
import type { AudioSlot, WlChainChange, WlChainInput, WlSnapshot } from '../types'
import { engineChanges, type TuneRender } from './types'

/** What a tune session needs from the desktop bridge (a fake in tests, the CLI harness in tools/tune-real). */
export type TuneBridge = RenderBridge & Pick<DesktopBridge, 'wavelinkRead'>

export interface TuneSession {
  /** Baseline chain in real units, for tune(). */
  chain: ChainSlot[]
  /** Applies `changes` on top of the baseline (values and switches not listed go back to baseline), then renders the take. */
  render: TuneRender
  /**
   * Wave Link changes for the given final changes (what Save writes), via renderExportStates: a result's changes as
   * they are (a band's `also` values included). A slot switched off or on is written as its BypassState; an Elgato
   * plugin taken off its own bypass as its exported state, which carries that bypass.
   */
  exportChanges(changes: readonly (Change & { also?: readonly ValueChange[] })[]): Promise<WlChainChange[]>
  close(): Promise<void>
}

/**
 * The Wave Link input the session's chain was built from: render_open takes the mic input (list_inputs' first), so the
 * first input whose entries match the slots by index and name. Null when none does (the file changed in between).
 */
export function inputOf(snap: WlSnapshot, slots: readonly AudioSlot[]): WlChainInput | null {
  const matches = (i: WlChainInput): boolean =>
    i.entries.length === slots.length && slots.every((s) => i.entries.some((e) => e.index === s.index && e.name === s.name))
  return snap.inputs.find(matches) ?? null
}

/** The baseline chain with changes on top (a later change of the same value or switch wins; `also` values count). */
export const chainWith = (base: readonly ChainSlot[], changes: readonly (Change & { also?: readonly ValueChange[] })[]): ChainSlot[] =>
  engineChanges(changes).reduce<ChainSlot[]>((c, x) => withChange(c, x), [...base])

const keysOf = (a: ChainSlot, b: ChainSlot): string[] => [...new Set([...Object.keys(a.values), ...Object.keys(b.values)])]

/**
 * The engine commands that take the session from `current` to `target`, one per changed value (one state load per
 * ReaEQ slot, whatever number of its bands moved) and one bypass per slot switched on or off (`on`; it comes before
 * the slot's values). A value that goes back to the baseline gets the plugin's own parameter value from when the
 * session opened, so the export finds it unchanged. Throws for a value the adapter cannot set (a render would not be
 * what it says).
 */
export function opsBetween(current: readonly ChainSlot[], target: readonly ChainSlot[], base: readonly ChainSlot[], slots0: readonly AudioSlot[], entries: WlChainInput['entries']): { op: EngineOp; slot: number; keys: string[]; on?: boolean }[] {
  const out: { op: EngineOp; slot: number; keys: string[]; on?: boolean }[] = []
  for (const t of target) {
    const c = current.find((s) => s.index === t.index)
    const b = base.find((s) => s.index === t.index)
    if (!c || !b) continue
    if (c.on !== t.on) {
      if (!slots0.some((s) => s.index === t.index && s.status.status === 'hosted')) throw new Error(`cannot switch ${t.name} in the render session`)
      out.push({ op: { op: 'bypass', slot: t.index, bypassed: !t.on }, slot: t.index, keys: [], on: t.on })
    }
    const changed = keysOf(c, t).filter((k) => c.values[k] !== t.values[k])
    if (!changed.length) continue
    const groups = t.kind === 'reaeq' ? [changed] : changed.map((k) => [k])
    for (const keys of groups) {
      const key = keys[0]
      const to = t.values[key]
      if (to === undefined) throw new Error(`slot ${t.index} has no value ${key}`)
      const change: ValueChange = { id: `tune:${t.index}:${key}`, reason: 'tone', titleMsg: { key: 'desktop.advice.undo' }, kind: 'value', slot: t.index, key, from: c.values[key] ?? to, to }
      let op = engineOp(change, target, slots0, entries)
      if (!op) throw new Error(`cannot set ${t.name} ${key} in the render session`)
      if (op.op === 'param' && b.values[key] !== undefined && sameValue(to, b.values[key])) {
        const id = op.id
        const own = slots0.find((s) => s.index === t.index)?.params.find((p) => p.id === id)
        if (own) op = { ...op, value: own.normalized }
      }
      out.push({ op, slot: t.index, keys })
    }
  }
  return out
}

/**
 * Opens the render session on the Wave Link mic chain and reads its entries (Settings.json is only read). The chain
 * says off for a slot the render passes through (Wave Link BypassState, or the plugin's own bypass: ../slots.ts
 * ownBypassOn), so tune() never spends renders on values that do nothing. Rejects
 * when either fails or the two do not describe the same chain; the render session is closed again then.
 * `take` is the raw take every `render` runs (mono, 48 kHz). Calls are serialized: one engine command at a time.
 */
export async function openTuneSession(bridge: TuneBridge, take: Float32Array): Promise<TuneSession> {
  const status = await bridge.renderOpen()
  let input: WlChainInput | null
  try {
    input = inputOf(await bridge.wavelinkRead(), status.slots)
    if (!input) throw new Error('Wave Link Settings.json does not describe the chain the render session opened')
  } catch (e) {
    await bridge.renderClose().catch(() => undefined)
    throw e
  }
  const { key: inputKey, entries } = input
  const slots0 = status.slots
  // as Wave Link lists it (what Save compares with), and as the render plays it: a plugin passing audio through on
  // its own bypass is off for the tuner, since its values do nothing in a render
  const listed = chainOf(slots0, entries)
  const base = listed.map((c) => (c.on && slots0.some((s) => s.index === c.index && ownBypassOn(s)) ? { ...c, on: false } : c))
  let slots: AudioSlot[] = [...slots0]
  let applied: ChainSlot[] = base
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(f: () => Promise<T>): Promise<T> => {
    const p = queue.then(f)
    queue = p.catch(() => undefined)
    return p
  }

  const send = (op: EngineOp): Promise<AudioSlot> =>
    op.op === 'param' ? bridge.renderSetParam(op.slot, op.id, op.value) : op.op === 'state' ? bridge.renderLoadState(op.slot, op.parameterState) : bridge.renderSetBypass(op.slot, op.bypassed)

  /** Puts the session's plugins at `target`; what was applied is tracked per value, so a failure resends the rest. */
  const applyChain = async (target: readonly ChainSlot[]): Promise<void> => {
    for (const { op, slot, keys, on } of opsBetween(applied, target, base, slots0, entries)) {
      const reply = await send(op)
      slots = slots.map((s) => (s.index === reply.index ? reply : s))
      const want = target.find((s) => s.index === slot)
      if (want) applied = applied.map((s) => (s.index === slot ? { ...s, on: on ?? s.on, values: { ...s.values, ...Object.fromEntries(keys.map((k) => [k, want.values[k]])) } } : s))
    }
  }

  return {
    chain: base.map((s) => ({ ...s, values: { ...s.values } })),
    render: (changes) =>
      serial(async () => {
        await applyChain(chainWith(base, changes))
        return bridge.renderRun(take)
      }),
    exportChanges: (changes) =>
      serial(async () => {
        const target = chainWith(base, changes)
        await applyChain(target)
        // Wave Link lists a plugin on its own bypass as on: one the changes switched on starts as off here too, so the
        // export sees it changed and writes the state that takes it off that bypass
        const start = listed.map((c) => (c.on && !base.some((b) => b.index === c.index && b.on) && target.some((x) => x.index === c.index && x.on) ? { ...c, on: false } : c))
        const plan = exportPlan(inputKey, start, chainWith(start, changes), slots, entries, await bridge.renderExportStates())
        if (plan.unsaved.length) throw new Error(`slots ${plan.unsaved.join(', ')} changed but cannot be written`)
        return plan.changes
      }),
    close: () => serial(() => bridge.renderClose()),
  }
}
