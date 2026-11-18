// One tuning run's state: the kept changes with their render, the render budget and the keep-or-revert rule. Pure
// apart from calling the injected render.
import { WET_CAP } from '../../plain/refine'
import type { Msg } from '../../plain/types'
import { sameValue, slotsWith } from '../advice/chain'
import type { AdviceReason, ChainSlot, ValueChange } from '../advice/types'
import { changeLineMsg } from '../changeMsg'
import { measure, type Measured, type TakeMask } from './measure'
import { withMoveDb } from './msgs'
import { LEVEL_REGRESS_SHARE, REGRESS_SHARE, scoreOf, toneOf, worseBecause, type ScorePart, type TrimRange } from './score'
import type { TuneTargets } from './targets'
import type { TuneChange, TuneLogEntry, TuneLogEvent, TuneMetric, TuneRender, TuneStage } from './types'

/** Renders a run may use, and how many of them each stage may take (the baseline takes one, a retune start one more). */
export const DEFAULT_MAX_RENDERS = 16
export const STAGE_RENDERS: Readonly<Record<Exclude<TuneStage, 'baseline'>, number>> = { level: 2, noise: 4, tone: 3, compression: 3, trim: 2 }

/** A value the tuner wants to set, with why and the metric it is for. */
export interface Move {
  slot: ChainSlot
  key: string
  to: number
  reason: AdviceReason
  titleMsg: Msg
  metric: TuneMetric
  /** BANDS index, for `tone`. */
  band?: number
}

/** A kept move: `before` is its metric right before the value first moved. */
export interface Pending extends Move {
  stage: TuneStage
  before: number
}

export type Outcome = 'kept' | 'reverted' | 'budget' | 'same'

export interface SessionInit {
  chain: readonly ChainSlot[]
  mask: TakeMask
  targets: TuneTargets
  render: TuneRender
  maxRenders: number
  onProgress?: (stage: TuneStage, pass: number, of: number) => void
}

const targetKey = (slot: ChainSlot, key: string): string => `${slot.index}:${key}`

/** Value of a summary metric (tone: the band's deviation from the style target). */
export function metricOf(m: Measured, t: TuneTargets, metric: TuneMetric, band?: number): number {
  if (metric === 'tone') return toneOf(m, t)[band ?? 0]
  return m[metric]
}

export class Session {
  readonly chain: readonly ChainSlot[]
  readonly mask: TakeMask
  readonly targets: TuneTargets
  readonly maxRenders: number
  readonly log: TuneLogEntry[] = []
  renders = 0
  /** Kept changes by `<slot>:<key>`, their render and what it measures. */
  set = new Map<string, Pending>()
  audio: Float32Array = new Float32Array(0)
  m!: Measured
  /** What the latest render measured, kept or not. */
  last!: Measured
  /** A stage wanted a render the budget did not have. */
  outOfBudget = false
  /** The last gain stage: the last switched-on ReaComp's Wet, inside 0..WET_CAP (or where it already is). */
  readonly gain: { slot: ChainSlot; lo: number; hi: number } | null
  private readonly used = new Map<TuneStage, number>()
  /** Candidates already rendered and rejected from a kept state: the same question is not rendered twice. */
  private readonly rejected = new Set<string>()
  private readonly renderFn: TuneRender
  private readonly onProgress?: SessionInit['onProgress']

  constructor(init: SessionInit) {
    this.chain = init.chain
    this.mask = init.mask
    this.targets = init.targets
    this.maxRenders = init.maxRenders
    this.renderFn = init.render
    this.onProgress = init.onProgress
    const comp = slotsWith(init.chain, 'reacomp', 'wetDb').at(-1)
    this.gain = comp ? { slot: comp, lo: Math.min(0, comp.values.wetDb), hi: Math.max(WET_CAP, comp.values.wetDb) } : null
  }

  note(stage: TuneStage, event: TuneLogEvent, text: string, score?: TuneLogEntry['score']): void {
    this.log.push(score ? { stage, event, text, score } : { stage, event, text })
  }

  /** Value a key has now: the kept change, else the chain's. */
  value(slot: ChainSlot, key: string, set: ReadonlyMap<string, Pending> = this.set): number {
    return set.get(targetKey(slot, key))?.to ?? slot.values[key]
  }

  /** How far the last gain stage can still move with a set of changes. */
  trim(set: ReadonlyMap<string, Pending> = this.set): TrimRange | null {
    if (!this.gain) return null
    const wet = this.value(this.gain.slot, 'wetDb', set)
    return { down: Math.min(0, this.gain.lo - wet), up: Math.max(0, this.gain.hi - wet) }
  }

  /** Renders a stage may still use: its own allowance, the budget, and one render kept back for the final trim. */
  left(stage: TuneStage): number {
    const own = stage === 'baseline' ? Infinity : STAGE_RENDERS[stage] - (this.used.get(stage) ?? 0)
    const reserve = stage === 'trim' || stage === 'baseline' ? 0 : 1
    return Math.max(0, Math.min(own, this.maxRenders - reserve - this.renders))
  }

  /** The value changes of a set, as the render and the engine take them. */
  changesOf(set: ReadonlyMap<string, Pending> = this.set): ValueChange[] {
    return [...set.values()].map((p) => ({
      id: `tune:${p.slot.index}:${p.key}`,
      reason: p.reason,
      titleMsg: p.titleMsg,
      kind: 'value' as const,
      slot: p.slot.index,
      key: p.key,
      from: p.slot.values[p.key],
      to: p.to,
    }))
  }

  /** One render, counted. Throws when the render does not return the take's length. */
  async render(stage: TuneStage, set: ReadonlyMap<string, Pending>): Promise<{ audio: Float32Array; m: Measured }> {
    this.renders++
    this.used.set(stage, (this.used.get(stage) ?? 0) + 1)
    this.onProgress?.(stage, this.renders, this.maxRenders)
    const audio = await this.renderFn(this.changesOf(set))
    return this.measured(audio)
  }

  /** Measures a render of this take (length-checked). */
  measured(audio: Float32Array): { audio: Float32Array; m: Measured } {
    const want = this.mask.frames * this.mask.win
    if (audio.length < want) throw new Error(`render returned ${audio.length} samples, the take has at least ${want}`)
    const m = measure(this.mask, audio)
    this.last = m
    return { audio, m }
  }

  /** The set with moves applied: a move back to the chain's value drops the change; null when nothing would change. */
  withMoves(stage: TuneStage, moves: readonly Move[]): Map<string, Pending> | null {
    const next = new Map(this.set)
    let changed = false
    for (const mv of moves) {
      const k = targetKey(mv.slot, mv.key)
      const cur = this.value(mv.slot, mv.key)
      if (!Number.isFinite(mv.to) || sameValue(mv.to, cur)) continue
      changed = true
      if (sameValue(mv.to, mv.slot.values[mv.key])) {
        next.delete(k)
        continue
      }
      const old = next.get(k)
      next.set(k, old ? { ...old, to: mv.to, ...(old.stage === stage ? { titleMsg: mv.titleMsg, band: mv.band } : {}) } : { ...mv, stage, before: metricOf(this.m, this.targets, mv.metric, mv.band) })
    }
    return changed ? next : null
  }

  /**
   * The closed loop: render the chain with these moves on top of what is kept, measure it, and keep the moves only
   * when the judged score improves (worseBecause: total down by MIN_GAIN, no other part worse by more than
   * REGRESS_TOL; only the total when the kept render had lost the voice) and `check` (the stage's own measured-effect
   * rule) has no objection. Otherwise nothing changes: the kept state and its render stay as they were, and the same
   * candidate from the same kept state is not rendered again. `asRendered`: judge the level as rendered and let the
   * other parts give up to what the level wins (the level stages, LEVEL_REGRESS_SHARE); otherwise only what the final
   * trim cannot repair counts.
   */
  async tryMoves(
    stage: TuneStage,
    moves: readonly Move[],
    part: ScorePart,
    check?: (before: Measured, after: Measured) => string | null,
    asRendered = false,
  ): Promise<Outcome> {
    const next = this.withMoves(stage, moves)
    if (!next) return 'same'
    const asked = `${setKey(this.set)} > ${setKey(next)} | ${part} ${asRendered}`
    if (this.rejected.has(asked)) {
      this.note(stage, 'skip', `${describe(moves)}: already tried from here`)
      return 'reverted'
    }
    if (this.left(stage) < 1) {
      this.outOfBudget = true
      this.note(stage, 'skip', `no render left for ${describe(moves)}`)
      return 'budget'
    }
    const before = scoreOf(this.m, this.targets, asRendered ? null : this.trim())
    const { audio, m } = await this.render(stage, next)
    const after = scoreOf(m, this.targets, asRendered ? null : this.trim(next))
    this.note(stage, 'render', `#${this.renders} ${describe(moves)}`, after)
    const why = check?.(this.m, m) ?? worseBecause(before, after, part, this.m.silent, asRendered ? LEVEL_REGRESS_SHARE : REGRESS_SHARE)
    if (why) {
      this.rejected.add(asked)
      this.note(stage, 'revert', `${describe(moves)}: ${why}`)
      return 'reverted'
    }
    this.note(stage, 'keep', `${describe(moves)}: score ${before.total.toFixed(1)} → ${after.total.toFixed(1)}`)
    this.set = next
    this.audio = audio
    this.m = m
    return 'kept'
  }

  /**
   * The kept changes in chain order, with their exact change line, the size of the whole move and the final value in
   * the reason (`db`, `to`) and the metric before → in the final render.
   */
  result(): TuneChange[] {
    const changes = this.changesOf()
    return [...this.set.values()]
      .map((p, i) => ({
        ...changes[i],
        titleMsg: withMoveDb(p.titleMsg, Math.abs(p.to - p.slot.values[p.key]), p.to),
        stage: p.stage,
        changeMsg: changeLineMsg(p.slot, changes[i]),
        effect: { metric: p.metric, ...(p.band === undefined ? {} : { band: p.band }), before: p.before, after: metricOf(this.m, this.targets, p.metric, p.band) },
      }))
      .sort((a, b) => a.slot - b.slot)
  }
}

const setKey = (set: ReadonlyMap<string, Pending>): string => [...set].map(([k, p]) => `${k}=${p.to}`).sort().join(';')
const describe = (moves: readonly Move[]): string => moves.map((mv) => `${mv.slot.kind}[${mv.slot.index}].${mv.key} → ${mv.to}`).join(', ')
