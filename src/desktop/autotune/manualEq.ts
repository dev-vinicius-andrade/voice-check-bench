// Hand changes to the ReaEQ on top of a tune result (SPEC "Tune from a recording — spectrum"). Framework-free.
// CONTRACT: the signatures and their meaning are fixed (the result step's hooks are written against them).
import type { Msg } from '../../plain/types'
import { eqKey, sameValue, slotAt, withChange } from '../advice/chain'
import type { ChainSlot, Change, ValueChange } from '../advice/types'
import { bandChangeMsg, changeLineMsg } from '../changeMsg'
import type { TakeSummary, TuneChange, TuneResult } from '../tune'
import { measure, N_CELLS, prepareTake, TUNE_SAMPLE_RATE, type Measured, type TakeMask } from '../tune/measure'
import { chainWith } from '../tune/renderer'
import { scoreOf, summarize } from '../tune/score'
import { targetsOf, type TuneTargets } from '../tune/targets'

/**
 * One value set by hand on the tuned chain. `id` is `manual:<slot>:<key>`, `reason` 'tone', `from` the value on the
 * tuned chain (the session's chain with the result's changes), `to` the value set by hand.
 */
export type ManualEdit = ValueChange

/** The session's chain with a result's changes applied (a band's `also` values included, switches too). */
export function tunedChain(chain: readonly ChainSlot[], changes: readonly TuneChange[]): ChainSlot[] {
  // the render session's own rule (later change of the same value wins, `also` counts): what the tuner rendered
  return chainWith(chain, changes)
}

const sameTarget = (e: { slot: number; key: string }, slot: number, key: string): boolean => e.slot === slot && e.key === key

/**
 * `edits` with `slot`/`key` set to `to`: replaces the edit of the same slot and key; an edit back at the tuned value
 * (sameValue) is dropped. Returns `edits` itself when nothing changes. Unknown slot or key: unchanged.
 */
export function editManual(tuned: readonly ChainSlot[], edits: readonly ManualEdit[], slot: number, key: string, to: number): readonly ManualEdit[] {
  const s = slotAt(tuned, slot)
  if (!s || !Object.hasOwn(s.values, key) || !Number.isFinite(to)) return edits
  const from = s.values[key]
  const i = edits.findIndex((e) => sameTarget(e, slot, key))
  if (sameValue(to, from)) return i < 0 ? edits : edits.filter((_, j) => j !== i)
  if (i >= 0 && sameValue(edits[i].to, to)) return edits
  const base: ManualEdit = { id: `manual:${slot}:${key}`, reason: 'tone', titleMsg: { key: 'desktop.advice.undo' }, kind: 'value', slot, key, from, to }
  const edit: ManualEdit = { ...base, titleMsg: changeLineMsg(s, base) }
  return i < 0 ? [...edits, edit] : edits.map((e, j) => (j === i ? edit : e))
}

/** The tuned chain with the edits: what the plot's bands show. Slots without edits keep their identity. */
export function manualChain(tuned: readonly ChainSlot[], edits: readonly ManualEdit[]): ChainSlot[] {
  return edits.reduce<ChainSlot[]>((c, e) => withChange(c, e), [...tuned])
}

/**
 * What the session's `render` and `exportChanges` take for a result with hand edits: the result's changes, then the
 * edits. A hand edit of a value the tuner also changed must win in both (proved on the real session adapter's
 * behaviour: tests), whatever that takes (dropping or rewriting the tuner's value for that key, `also` included).
 */
export function allChanges(changes: readonly TuneChange[], edits: readonly ManualEdit[]): (Change & { also?: readonly ValueChange[] })[] {
  // The session applies a list in order and a later change of the same value wins (renderer.ts chainWith), so the
  // edits after the changes would already win. The tuner's own value for an edited key is rewritten too, so the list
  // never says two things about one value whichever way a consumer reads it. A rewritten change keeps its line and
  // effect (what the tuner did); the engine only reads slot, key and `to`.
  const edited = (slot: number, key: string): ManualEdit | undefined => edits.find((e) => sameTarget(e, slot, key))
  const used = new Set<ManualEdit>()
  const rewrite = <T extends ValueChange>(c: T): T => {
    const e = edited(c.slot, c.key)
    if (!e) return c
    used.add(e)
    return { ...c, to: e.to }
  }
  const out = changes.map((c): Change & { also?: readonly ValueChange[] } => {
    const own = c.kind === 'value' ? rewrite(c) : c
    return c.also ? { ...own, also: c.also.map(rewrite) } : own
  })
  return [...out, ...edits.filter((e) => !used.has(e))]
}

/** The raw take's fixed frames, analysed once per take (the same take is re-measured after every hand edit). */
const masks = new WeakMap<Float32Array, TakeMask | null>()
function maskOf(take: Float32Array): TakeMask | null {
  if (!masks.has(take)) masks.set(take, prepareTake(take, TUNE_SAMPLE_RATE))
  return masks.get(take) ?? null
}

/** A summary's own values as a Measured, for scoring its damage part (no spectrum: the tone part reads nothing). */
const asMeasured = (s: TakeSummary): Measured => ({
  speechDb: s.speechDb,
  peakDb: s.peakDb,
  clipped: s.clipped,
  pauseDb: s.pauseDb,
  snrDb: s.snrDb,
  spreadDb: s.spreadDb,
  deadSilence: s.deadSilence,
  gateSwitches: s.gateSwitches,
  wordLossDb: s.wordLossDb,
  pausePeakDb: NaN,
  quietPeakDb: NaN,
  silent: true,
  pumpDb: s.pumpDb,
  cutShare: s.cutSpeech,
  cutEvents: s.cutEvents,
  burstDb: s.burstDb,
  burstEvents: s.burstEvents,
  removerCut: s.removerCut,
  removerCutEvents: s.removerCutEvents,
  cells: new Float64Array(N_CELLS),
})

/**
 * The targets the tuner scored the result with. tune() allows dead-silent pauses when a Noise Removal is on (they are
 * its doing), which the result does not record: read from the summaries, whose damage was scored without the dead
 * silence part exactly when that was so.
 */
function targetsOfResult(result: TuneResult): TuneTargets {
  const t = targetsOf(result.goals, result.limit)
  if (t.allowDeadSilence) return t
  const relaxed = { ...t, allowDeadSilence: true }
  const scoredRelaxed = (s: TakeSummary): boolean => {
    const m = asMeasured(s)
    const strict = scoreOf(m, t).damage
    const loose = scoreOf(m, relaxed).damage
    return strict - loose > 1e-6 && Math.abs(s.score.damage - loose) < 1e-6
  }
  return scoredRelaxed(result.after) || scoredRelaxed(result.before) ? relaxed : t
}

/**
 * `result` as it is with a new render of the same take: `processed` replaced and `after` measured again the way the
 * tuner measures (same mask, same summary), so the result table shows what is heard. `changes`, `before`, `unmet`,
 * `goals` stay. Returns `result` with only `processed` replaced when the take cannot be measured.
 */
export function remeasured(take: Float32Array, result: TuneResult, processed: Float32Array): TuneResult {
  const mask = maskOf(take)
  if (!mask || processed.length < mask.frames * mask.win) return { ...result, processed }
  const m = measure(mask, processed)
  // One render gives level, peak, pauses / SNR, tone, spread, word loss, dead silence and bursts. What a gate cuts
  // (and how it pumps the room) is measured against a render of the same chain with its gates open, and what Noise
  // Removal cuts against one without it: renders the tuner made and this one does not, so the result's values stay.
  const prev = result.after
  m.cutShare = prev.cutSpeech
  m.cutEvents = prev.cutEvents
  m.pumpDb = prev.pumpDb
  m.removerCut = prev.removerCut
  m.removerCutEvents = prev.removerCutEvents
  return { ...result, processed, after: summarize(m, targetsOfResult(result)) }
}

const BAND_KEY = /^band(\d+)\.(\w+)$/

/** One line per ReaEQ band (or other value) changed by hand, in chain order: "ReaEQ Band 3: 1000 Hz, 1 oct, 0 dB → 923 Hz, 0.1 oct, −24 dB". */
export function manualLines(tuned: readonly ChainSlot[], edits: readonly ManualEdit[]): { id: string; msg: Msg }[] {
  const now = manualChain(tuned, edits)
  const out: { id: string; msg: Msg }[] = []
  tuned.forEach((slot, pos) => {
    const mine = edits
      .filter((e) => e.slot === slot.index && Object.hasOwn(slot.values, e.key))
      .map((e) => ({ e, band: slot.kind === 'reaeq' ? BAND_KEY.exec(e.key) : null }))
      .sort((a, b) => (a.band ? Number(a.band[1]) : Infinity) - (b.band ? Number(b.band[1]) : Infinity))
    const done = new Set<number>()
    for (const { e, band } of mine) {
      const n = band ? Number(band[1]) : NaN
      // a band whose frequency or width moved is one line with its three values, as the tuner's result shows it
      const shaped = band !== null && mine.some((x) => x.band !== null && Number(x.band[1]) === n && (x.band[2] === 'freqHz' || x.band[2] === 'bwOct'))
      if (band && shaped && (band[2] === 'freqHz' || band[2] === 'bwOct' || band[2] === 'gainDb')) {
        if (done.has(n)) continue
        done.add(n)
        const after = now[pos]
        const line = (s: ChainSlot): { hz: number; oct: number; db: number } => ({ hz: s.values[eqKey(n, 'freqHz')], oct: s.values[eqKey(n, 'bwOct')], db: s.values[eqKey(n, 'gainDb')] })
        out.push({ id: `manual:${slot.index}:band${n}`, msg: bandChangeMsg(slot, n, line(slot), line(after)) })
        continue
      }
      out.push({ id: e.id, msg: changeLineMsg(slot, { ...e, from: slot.values[e.key] }) })
    }
  })
  return out
}
