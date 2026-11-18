// One tuning run's state: the kept changes with their render, the render budget and the keep-or-revert rule. Pure
// apart from calling the injected render.
import { WET_CAP } from '../../plain/refine'
import type { Msg } from '../../plain/types'
import { eqKey, sameValue, slotsWith } from '../advice/chain'
import type { AdviceReason, ChainSlot, Change, SlotKind } from '../advice/types'
import { bandChangeMsg, changeLineMsg } from '../changeMsg'
import { GATE_OFF_WET_DB, gatePassesAll } from '../../plain/refine'
import { cutOf, fineLevels, measure, type Measured, type TakeMask } from './measure'
import { withMoveDb } from './msgs'
import { cutsSpeech, LEVEL_REGRESS_SHARE, MIN_GAIN, REGRESS_SHARE, REGRESS_TOL, scoreOf, toneOf, worseBecause, type ScorePart, type TrimRange } from './score'
import type { TuneTargets } from './targets'
import type { TuneChange, TuneLogEntry, TuneLogEvent, TuneMetric, TuneRender, TuneStage } from './types'

/** Renders a run may use, and how many of them each stage may take (the baseline takes one, a retune start one more). */
export const DEFAULT_MAX_RENDERS = 40
export const STAGE_RENDERS: Readonly<Record<Exclude<TuneStage, 'baseline'>, number>> = { level: 2, noise: 14, tone: 8, compression: 3, trim: 10 }

/** Marks a run in which a deeper or tighter gate was measured to cut speech (Session.refused): the room stays louder for it. */
export const GATE_DEEPER = 'deeper gate'

/** The key of a switch move: the slot on (`to` 1) or off (`to` 0). */
export const SWITCH_KEY = 'on'

/** A value the tuner wants to set (or a slot it wants on / off: key SWITCH_KEY), with why and the metric it is for. */
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
/** What a key had when the chain started (a switch: 1 on, 0 off). */
const baseOf = (slot: ChainSlot, key: string): number => (key === SWITCH_KEY ? (slot.on ? 1 : 0) : slot.values[key])

/** A switch move. */
export const switchMove = (slot: ChainSlot, on: boolean, rest: Pick<Move, 'reason' | 'titleMsg' | 'metric' | 'band'>): Move => ({ slot, key: SWITCH_KEY, to: on ? 1 : 0, ...rest })

/** Value of a summary metric (tone: the band's deviation from the style target). */
export function metricOf(m: Measured, t: TuneTargets, metric: TuneMetric, band?: number): number {
  if (metric === 'tone') return toneOf(m, t)[band ?? 0]
  if (metric === 'cutSpeech') return m.cutShare
  return m[metric]
}

export class Session {
  readonly chain: readonly ChainSlot[]
  readonly mask: TakeMask
  /** The run's targets; a kept Noise Removal relaxes them (dead-silent pauses are its doing, ./switches.ts). */
  targets: TuneTargets
  /** The targets allow dead silence only because a Noise Removal was switched on. */
  silentByRemover = false
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
  /** Candidates a render showed to cost the voice, not to be asked again in this run (./switches.ts). */
  readonly refused = new Set<string>()
  /** The last gain stage: the last switched-on ReaComp's Wet, inside 0..WET_CAP (or where it already is). */
  readonly gain: { slot: ChainSlot; lo: number; hi: number } | null
  /** Ungated renders (fineLevels) by what the chain is before its gates: the reference a gate's cutting is measured on. */
  private readonly refs = new Map<string, Float32Array>()
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
    return set.get(targetKey(slot, key))?.to ?? baseOf(slot, key)
  }

  /** Whether a slot is switched on now: as the chain had it, unless a kept switch says otherwise. */
  isOn(slot: ChainSlot, set: ReadonlyMap<string, Pending> = this.set): boolean {
    return this.value(slot, SWITCH_KEY, set) !== 0
  }

  /** Slots of a kind that have every key, in chain order: those switched on NOW (the kept switches count), or those off. */
  live(kind: SlotKind, ...keys: string[]): ChainSlot[] {
    return this.having(kind, keys).filter((c) => this.isOn(c))
  }

  off(kind: SlotKind, ...keys: string[]): ChainSlot[] {
    return this.having(kind, keys).filter((c) => !this.isOn(c))
  }

  private having(kind: SlotKind, keys: readonly string[]): ChainSlot[] {
    const on = slotsWith(
      this.chain.map((c) => (c.on ? c : { ...c, on: true })),
      kind,
      ...keys,
    )
    return on.flatMap((c) => this.chain.filter((x) => x.index === c.index))
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

  /** The changes of a set (values and switches), as the render and the engine take them. */
  changesOf(set: ReadonlyMap<string, Pending> = this.set): Change[] {
    return [...set.values()].map((p): Change => {
      const head = { id: `tune:${p.slot.index}:${p.key}`, reason: p.reason, titleMsg: p.titleMsg, slot: p.slot.index }
      if (p.key === SWITCH_KEY) return { ...head, kind: 'switch', on: p.to !== 0 }
      return { ...head, kind: 'value', key: p.key, from: p.slot.values[p.key], to: p.to }
    })
  }

  /** ReaGates that can close on something with a set of changes: switched on and not passing everything. */
  gatesWorking(set: ReadonlyMap<string, Pending> = this.set): ChainSlot[] {
    return this.having('reagate', ['wetDb', 'dryDb']).filter((g) => this.isOn(g, set) && !gatePassesAll({ wet: this.value(g, 'wetDb', set), dry: this.value(g, 'dryDb', set) }))
  }

  /** A set with its working gates passing everything at unity (Wet off, Dry 0 dB): the ungated chain. */
  private opened(set: ReadonlyMap<string, Pending>): Map<string, Pending> {
    const next = new Map(set)
    for (const g of this.gatesWorking(set)) {
      for (const [key, to] of [['wetDb', GATE_OFF_WET_DB], ['dryDb', 0]] as const) {
        const old = next.get(targetKey(g, key))
        if (sameValue(to, baseOf(g, key))) next.delete(targetKey(g, key))
        else next.set(targetKey(g, key), old ? { ...old, to } : { slot: g, key, to, reason: 'noisyPause', titleMsg: { key: 'desktop.advice.undo' }, metric: 'snrDb', stage: 'noise', before: NaN })
      }
    }
    return next
  }

  /** What a set is before its gates (every change that is not a ReaGate's): renders that share it share the ungated render. */
  private refKey(set: ReadonlyMap<string, Pending>): string {
    return setKey(new Map([...set].filter(([, p]) => p.slot.kind !== 'reagate')))
  }

  /** Keeps a render as the ungated reference of its set, when no gate works in it (a probe with the gates passing everything). */
  keepRef(set: ReadonlyMap<string, Pending>, audio: Float32Array): void {
    if (!this.gatesWorking(set).length) this.refs.set(this.refKey(set), fineLevels(audio, this.mask.sampleRate))
  }

  /**
   * Fills in what a render's gates cut (cutShare / cutEvents): 0 without a working gate, measured when the ungated
   * render of its set is there; otherwise the values of `like` (the state it was derived from) stand until checkCut.
   */
  cut(set: ReadonlyMap<string, Pending>, audio: Float32Array, m: Measured, like?: Measured): boolean {
    const ref = this.refs.get(this.refKey(set))
    if (!this.gatesWorking(set).length) {
      m.cutShare = 0
      m.cutEvents = 0
      m.pumpDb = 0
      return true
    }
    if (ref) {
      const c = cutOf(this.mask, audio, ref)
      m.cutShare = c.share
      m.cutEvents = c.events
      m.pumpDb = c.pump
      return true
    }
    m.cutShare = like ? like.cutShare : NaN
    m.cutEvents = like ? like.cutEvents : NaN
    m.pumpDb = like ? like.pumpDb : NaN
    this.stale.add(m)
    return false
  }

  /** Renders whose cut is carried over from the state before them, not measured. */
  private readonly stale = new WeakSet<Measured>()

  /** Renders the ungated chain of a set (one render, counted) unless it is there already. False without a render left. */
  async openRef(stage: TuneStage, set: ReadonlyMap<string, Pending>): Promise<boolean> {
    if (this.refs.has(this.refKey(set)) || !this.gatesWorking(set).length) return true
    if (this.left(stage) < 1) return false
    const last = this.last
    const open = this.opened(set)
    const { audio } = await this.render(stage, open)
    this.last = last
    this.refs.set(this.refKey(set), fineLevels(audio, this.mask.sampleRate))
    this.note(stage, 'render', `#${this.renders} the chain with its gates passing everything (what the gates are measured against)`)
    return true
  }

  /**
   * Makes sure the kept render's cut is measured, not carried over: renders the ungated chain when an upstream move
   * (EQ, compressor, level) changed what the gates receive. False when there is no render left for it.
   */
  async checkCut(stage: TuneStage): Promise<boolean> {
    if (Number.isFinite(this.m.cutShare) && !this.stale.has(this.m)) return true
    if (!(await this.openRef(stage, this.set))) return false
    this.stale.delete(this.m)
    return this.cut(this.set, this.audio, this.m)
  }

  /** The kept state, to come back to after a branch that did not pay (./switches.ts). */
  snapshot(): Kept {
    return { set: new Map(this.set), audio: this.audio, m: this.m }
  }

  restore(k: Kept): void {
    this.set = new Map(k.set)
    this.audio = k.audio
    this.m = k.m
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
      if (sameValue(mv.to, baseOf(mv.slot, mv.key))) {
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
   * trim cannot repair counts. `judge`: the targets the score is taken against (the tone stage's: targets.ts toneJudge).
   * What the gates cut (score damage) is measured for both renders when the moves touch a ReaGate (the ungated chain is
   * rendered once per upstream state, counted); for other moves the kept render's value stands until checkCut.
   * `repair`: the move is only for the damage — kept when the damage points drop by MIN_GAIN and `check` agrees,
   * whatever it costs the other parts (no voice over the room is worth cut words).
   */
  async tryMoves(
    stage: TuneStage,
    moves: readonly Move[],
    part: ScorePart,
    check?: (before: Measured, after: Measured) => string | null,
    asRendered = false,
    judge: TuneTargets = this.targets,
    repair = false,
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
    // a gate move is judged on what it cuts: the ungated chain first (same for the kept state and the candidate)
    if (!this.m.silent && moves.some((mv) => mv.slot.kind === 'reagate') && this.left(stage) >= 2 && (await this.openRef(stage, next))) {
      if (this.refKey(next) === this.refKey(this.set)) {
        this.stale.delete(this.m)
        this.cut(this.set, this.audio, this.m)
      }
    }
    const before = scoreOf(this.m, judge, asRendered ? null : this.trim())
    const { audio, m } = await this.render(stage, next)
    this.cut(next, audio, m, this.m)
    const after = scoreOf(m, judge, asRendered ? null : this.trim(next))
    this.note(stage, 'render', `#${this.renders} ${describe(moves)}${Number.isFinite(m.cutShare) && this.gatesWorking(next).length ? ` · speech cut ${(100 * m.cutShare).toFixed(1)} %` : ''}`, after)
    const damaged = repair ? (after.damage <= before.damage - MIN_GAIN ? null : `damage ${before.damage.toFixed(1)} → ${after.damage.toFixed(1)}: not repaired`) : undefined
    const why = check?.(this.m, m) ?? (repair ? damaged : worseBecause(before, after, part, this.m.silent, asRendered ? LEVEL_REGRESS_SHARE : REGRESS_SHARE))
    if (why) {
      if (!repair && moves.some((mv) => mv.slot.kind === 'reagate') && Number.isFinite(m.cutShare) && after.damage > before.damage + REGRESS_TOL && cutsSpeech(m)) this.refused.add(GATE_DEEPER)
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
   * the reason (`db`, `to`) and the metric before → in the final render. The moved values of one ReaEQ band whose
   * frequency or width moved are ONE change: the band's line, its gain first (the others in `also`).
   */
  result(): TuneChange[] {
    const changes = this.changesOf()
    const groups = new Map<string, { p: Pending; c: Change }[]>()
    ;[...this.set.values()].forEach((p, i) => {
      const band = p.slot.kind === 'reaeq' ? /^band(\d+)\./.exec(p.key)?.[1] : undefined
      const k = band ? `${p.slot.index}:band${band}` : targetKey(p.slot, p.key)
      groups.set(k, [...(groups.get(k) ?? []), { p, c: changes[i] }])
    })
    return [...groups.values()]
      .map((g): TuneChange => {
        const shaped = g.some(({ p }) => /\.(freqHz|bwOct)$/.test(p.key))
        const main = (shaped && g.find(({ p }) => p.key.endsWith('.gainDb'))) || g[0]
        const { p, c } = main
        const also = g.filter((x) => x !== main).flatMap((x) => (x.c.kind === 'value' ? [x.c] : []))
        const n = Number(/^band(\d+)\./.exec(p.key)?.[1])
        const at = (field: 'freqHz' | 'bwOct' | 'gainDb', now: boolean): number => (now ? this.value(p.slot, eqKey(n, field)) : p.slot.values[eqKey(n, field)])
        const band = (now: boolean): { hz: number; oct: number; db: number } => ({ hz: at('freqHz', now), oct: at('bwOct', now), db: at('gainDb', now) })
        return {
          ...c,
          titleMsg: p.key === SWITCH_KEY ? p.titleMsg : withMoveDb(p.titleMsg, Math.abs(p.to - baseOf(p.slot, p.key)), p.to),
          stage: p.stage,
          changeMsg: shaped ? bandChangeMsg(p.slot, n, band(false), band(true)) : changeLineMsg(p.slot, c),
          effect: { metric: p.metric, ...(p.band === undefined ? {} : { band: p.band }), before: p.before, after: metricOf(this.m, this.targets, p.metric, p.band) },
          ...(also.length ? { also } : {}),
        }
      })
      .sort((a, b) => a.slot - b.slot)
  }
}

/** A kept state of a run: the changes, their render and what it measures. */
export interface Kept {
  set: Map<string, Pending>
  audio: Float32Array
  m: Measured
}

const setKey = (set: ReadonlyMap<string, Pending>): string => [...set].map(([k, p]) => `${k}=${p.to}`).sort().join(';')
const describe = (moves: readonly Move[]): string =>
  moves.map((mv) => (mv.key === SWITCH_KEY ? `${mv.slot.kind}[${mv.slot.index}] ${mv.to ? 'on' : 'off'}` : `${mv.slot.kind}[${mv.slot.index}].${mv.key} → ${mv.to}`)).join(', ')
