// Tune the real chain on one recording (SPEC "Desktop app (v2.0)" → Tune from a recording). Framework-free.
// tune() renders the raw take through the chain, measures the whole take, and walks the stages level → noise & gate →
// tone → compression → final trim. Every candidate change is rendered and kept only when the measured score improves
// (./session.ts tryMoves, ./score.ts); "no change" is a valid result. retune() starts the next run from a result.
import { OVER_SWITCH_WARN } from '../../audio/diagnose'
import { CHOPPED_ZERO, gatePassesAll } from '../../plain/refine'
import type { Msg } from '../../plain/types'
import { sameValue, slotAt, slotsWith } from '../advice/chain'
import { AMOUNTS } from '../advice/prefs'
import type { ChainSlot } from '../advice/types'
import { EQ_GRID_DB } from './eqModel'
import { prepareTake, TUNE_SAMPLE_RATE } from './measure'
import { bandRange, unmetMsg } from './msgs'
import { CHOP_OK_DB, MIN_GAIN, scoreOf, summarize, toneOf } from './score'
import { DEFAULT_MAX_RENDERS, Session, type Pending } from './session'
import { compressionStage, levelStage, noiseStage } from './stages'
import { targetsOf, toneExcess, type TuneTargets } from './targets'
import { toneStage, type ToneNotes } from './toneStage'
import type { Bother, TakeSummary, TuneChange, TuneGoals, TuneInput, TuneResult, TuneResume } from './types'

/** Unmet goals are reported from this far off: level and SNR dB, tone dB outside the tolerance, spread dB. */
export const UNMET_LEVEL_DB = 2
export const UNMET_SNR_DB = 1
export const UNMET_TONE_DB = 0.5
export const UNMET_SPREAD_DB = 0.5
/** The Wet had at least this much room left the way the level needed: not its limit that stopped it, dB. */
export const LEVEL_ROOM_DB = 0.5

const nanSummary = (): TakeSummary => ({
  speechDb: NaN,
  peakDb: NaN,
  clipped: 0,
  pauseDb: NaN,
  snrDb: NaN,
  tone: new Array<number>(9).fill(NaN),
  spreadDb: NaN,
  deadSilence: 0,
  gateSwitches: 0,
  wordLossDb: NaN,
  score: { level: 0, noise: 0, tone: 0, consistency: 0, damage: 0, total: 0 },
})

const isLevel = (c: Pick<TuneChange, 'stage'>): boolean => c.stage === 'level' || c.stage === 'trim'
const stepOf = (key: string): number => (key === 'ratio' ? 0.1 : key === 'strength' || key.endsWith('Ms') ? 1 : EQ_GRID_DB)
const snap = (v: number, key: string): number => Math.round(v / stepOf(key)) * stepOf(key) || 0

/** Largest move the caps allow a value of a previous result (level moves are not capped: the level is not "processing"). */
function capOf(slot: ChainSlot, key: string, t: TuneTargets): number {
  if (slot.kind === 'reaeq') return t.caps.eqStepDb
  if (slot.kind === 'noiseRemoval') return t.caps.nrMax
  if (slot.kind === 'reagate' && key === 'thresholdDb') return t.caps.gateDb
  if (slot.kind === 'reacomp' && key === 'ratio') return Math.max(0, t.caps.ratio - slot.values.ratio)
  return Infinity
}

/** A previous result's changes as a start state, pulled inside this run's caps; changes on missing values are dropped. */
function startSet(start: readonly TuneChange[], chain: readonly ChainSlot[], t: TuneTargets): Map<string, Pending> {
  const set = new Map<string, Pending>()
  const eq = start.filter((c) => slotAt(chain, c.slot)?.kind === 'reaeq')
  const eqTotal = eq.reduce((s, c) => s + Math.abs(c.to - c.from), 0)
  const eqScale = eqTotal > t.caps.eqTotalDb ? t.caps.eqTotalDb / eqTotal : 1
  for (const c of start) {
    const slot = slotAt(chain, c.slot)
    const base = slot?.values[c.key]
    if (!slot || !slot.on || base === undefined || !Number.isFinite(base) || !Number.isFinite(c.to)) continue
    let to = c.to
    if (!isLevel(c)) {
      const cap = capOf(slot, c.key, t)
      const move = (c.to - base) * (slot.kind === 'reaeq' ? eqScale : 1)
      to = snap(base + Math.min(cap, Math.max(-cap, move)), c.key)
    }
    if (sameValue(to, base)) continue
    set.set(`${slot.index}:${c.key}`, { slot, key: c.key, to, reason: c.reason === 'undo' ? 'tone' : c.reason, titleMsg: c.titleMsg, metric: c.effect.metric, band: c.effect.band, stage: c.stage, before: c.effect.before })
  }
  return set
}

/** The goals a run could not reach, most important first, from what the final render measures. */
function unmetOf(s: Session, tone: ToneNotes): Msg[] {
  const out: Msg[] = []
  const t = s.targets
  const m = s.m
  const a = s.mask.analysis
  if (a.clip > 0) out.push(unmetMsg('clipped', { count: a.clip }))
  if (m.silent) {
    // the voice does not come out at all: nothing else can be said about this render
    out.push(unmetMsg('silent'))
    if (s.outOfBudget) out.push(unmetMsg('budget', { renders: s.renders }))
    return out
  }

  const err = t.speechDb - m.speechDb
  if (Math.abs(err) >= UNMET_LEVEL_DB) {
    const db = Math.abs(err)
    // Wet still had room: the move was there but made the rest measure worse (an effect after it reacts to level)
    const room = s.trim()
    const held = room !== null && (err < 0 ? room.down < -LEVEL_ROOM_DB : room.up > LEVEL_ROOM_DB)
    if (!s.gain) out.push(unmetMsg(err > 0 ? 'level.noToolQuiet' : 'level.noToolLoud', { db }))
    else if (err > 0 && t.peakCeilDb - m.peakDb < 1) out.push(unmetMsg('level.peaks', { db }))
    else if (held) out.push(unmetMsg('level.held', { db }))
    else out.push(unmetMsg(err < 0 ? 'level.capLoud' : 'level.capQuiet', { db }))
  }

  const dead = !t.allowDeadSilence && (m.deadSilence > CHOPPED_ZERO || m.gateSwitches > OVER_SWITCH_WARN)
  const chopped = m.wordLossDb > CHOP_OK_DB
  if (dead) out.push(unmetMsg('dead'))
  if (chopped) out.push(unmetMsg('chopped'))
  if (!dead && !chopped && m.snrDb < t.snrDb - UNMET_SNR_DB) {
    const tool =
      slotsWith(s.chain, 'noiseRemoval', 'strength').length > 0 ||
      slotsWith(s.chain, 'reagate', 'thresholdDb', 'wetDb', 'dryDb').some((g) => !gatePassesAll({ wet: s.value(g, 'wetDb'), dry: s.value(g, 'dryDb') }))
    out.push(unmetMsg(tool ? 'noise.limit' : 'noise.noTool', { snr: m.snrDb, target: t.snrDb }))
  }

  const dev = toneOf(m, t)
  const excess = toneExcess(dev, t)
  const off = excess.map((e, b) => ({ e, b })).filter(({ e, b }) => t.weight[b] > 0 && e >= UNMET_TONE_DB)
  if (off.length && tone.noEq) out.push(unmetMsg('tone.noEq'))
  else {
    for (const { b } of off) {
      const high = dev[b] + t.shift[b] > 0
      // the plain distance from the style target when it points the same way, else how far outside the wanted range
      const db = dev[b] > 0 === high ? Math.abs(dev[b]) : excess[b]
      if (b === 7 && high) out.push(unmetMsg('tone.sharpS', { db }))
      else if (!tone.reach[b]) out.push(unmetMsg('tone.noBand', bandRange(b)))
      else out.push(unmetMsg(high ? 'tone.limitHigh' : 'tone.limitLow', { ...bandRange(b), db }))
    }
  }

  if (m.spreadDb > t.spreadDb + UNMET_SPREAD_DB) {
    const comp = slotsWith(s.chain, 'reacomp', 'thresholdDb', 'ratio').length > 0
    out.push(unmetMsg(comp ? 'spread.limit' : 'spread.noComp', { spread: m.spreadDb, target: t.spreadDb }))
  }
  if (s.outOfBudget) out.push(unmetMsg('budget', { renders: s.renders }))
  return out
}

/**
 * Tunes the chain on one take.
 * 1. The raw take is analysed once; its speech and pause frames are the frames every render is measured on.
 * 2. Render the chain as it is → `before`.
 * 3. Stages, in order: level (make-up Wet toward the speech target, peaks kept under the ceiling) → noise & gate →
 *    tone → compression → final trim (the level again, after everything else moved it). Each stage proposes moves
 *    from the kept render's measurements; each proposal is one render and is kept only if the score says so.
 * 4. Result: the kept changes, before / after summaries, the final render, renders used, unmet goals, a debug log.
 * Deterministic for a deterministic render. Uses at most `maxRenders` renders (default DEFAULT_MAX_RENDERS).
 * A take without enough speech returns no changes and `desktop.autotune.unmet.notEnoughSpeech` (one render).
 */
export async function tune(input: TuneInput): Promise<TuneResult> {
  const sampleRate = input.sampleRate ?? TUNE_SAMPLE_RATE
  const limit = Number.isFinite(input.limit) ? Math.min(1, Math.max(0, input.limit ?? 1)) : 1
  const goals: TuneGoals = { ...input.goals, bothers: [...input.goals.bothers] }
  const targets = targetsOf(goals, limit)
  const maxRenders = Math.max(1, Math.floor(input.maxRenders ?? DEFAULT_MAX_RENDERS))
  const mask = prepareTake(input.take, sampleRate)
  if (!mask) {
    input.onProgress?.('baseline', 1, maxRenders)
    const processed = await input.render([])
    const log = [{ stage: 'baseline' as const, event: 'skip' as const, text: 'the take has not enough speech to analyse' }]
    return { changes: [], before: nanSummary(), after: nanSummary(), processed, renders: 1, unmet: [unmetMsg('notEnoughSpeech')], log, goals, limit }
  }

  const s = new Session({ chain: input.chain, mask, targets, render: input.render, maxRenders, onProgress: input.onProgress })
  const base = await s.render('baseline', s.set)
  s.audio = base.audio
  s.m = base.m
  const before = summarize(base.m, targets)
  s.note('baseline', 'render', `#1 the chain as it is: speech ${base.m.speechDb.toFixed(1)} dBFS, pauses ${base.m.pauseDb.toFixed(1)} dBFS`, scoreOf(base.m, targets, s.trim()))

  // retune: start from the previous result when it still beats the untouched chain under this run's goals
  const given = input.start ?? []
  const start = startSet(given, input.chain, targets)
  if (start.size) {
    const same = given.length === start.size && given.every((c) => sameValue(start.get(`${c.slot}:${c.key}`)?.to ?? NaN, c.to))
    const reuse = same && input.startRender?.length === base.audio.length ? input.startRender : undefined
    if (reuse || s.left('baseline') > 0) {
      const from = reuse ? s.measured(reuse) : await s.render('baseline', start)
      const a = scoreOf(base.m, targets, s.trim())
      const b = scoreOf(from.m, targets, s.trim(start))
      if (b.total <= a.total - MIN_GAIN) {
        s.set = start
        s.audio = from.audio
        s.m = from.m
        s.note('baseline', 'keep', `starting from the previous result: score ${a.total.toFixed(1)} → ${b.total.toFixed(1)}`, b)
      } else s.note('baseline', 'revert', `the previous result does not beat the untouched chain (${a.total.toFixed(1)} → ${b.total.toFixed(1)}): starting over`, b)
    } else s.note('baseline', 'skip', 'no render left to start from the previous result')
  }

  await levelStage(s, 'level')
  await noiseStage(s)
  const tone = await toneStage(s)
  await compressionStage(s)
  await levelStage(s, 'trim')

  return { changes: s.result(), before, after: summarize(s.m, targets), processed: s.audio, renders: s.renders, unmet: unmetOf(s, tone), log: s.log, goals, limit }
}

/**
 * What to run next after the person listened to a result: `tune({ take, chain, render, ...retune(result, feedback) })`.
 * - 'tooProcessed': one amount lighter (on the lightest amount: the caps halve, `limit` × 0.5), and every change
 *   except the level starts halfway back to where the chain was. The run then keeps what still measures better
 *   inside the smaller caps and trims the level again.
 * - bothers (what still bothers them): added to the goals; the run starts from the previous changes and render.
 *   A bother that was already a goal means "more": the halved caps come back first, else the amount goes one up.
 */
export function retune(result: TuneResult, feedback: readonly Bother[] | 'tooProcessed'): TuneResume {
  const i = Math.max(0, AMOUNTS.indexOf(result.goals.amount))
  if (feedback === 'tooProcessed') {
    const lighter = i > 0
    const start = result.changes
      .map((c) => (isLevel(c) ? c : { ...c, to: snap(c.from + (c.to - c.from) / 2, c.key) }))
      .filter((c) => !sameValue(c.to, c.from))
    return { goals: { ...result.goals, amount: AMOUNTS[lighter ? i - 1 : i] }, limit: lighter ? result.limit : result.limit * 0.5, start }
  }
  const again = feedback.some((b) => result.goals.bothers.includes(b))
  const bothers = [...new Set([...result.goals.bothers, ...feedback])]
  let amount = result.goals.amount
  let limit = result.limit
  if (again) {
    if (limit < 1) limit = Math.min(1, limit * 2)
    else amount = AMOUNTS[Math.min(AMOUNTS.length - 1, i + 1)]
  }
  return { goals: { ...result.goals, bothers, amount }, limit, start: result.changes, startRender: result.processed }
}
