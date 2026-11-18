// "Calibrate noise" on the live screen (SPEC "Calibrate noise live"): the person leaves the mic on, the calibration
// sets the noise removal (or the gate) while they hear it. Framework-free state machine: fed the engine's stream frames
// (raw and processed, aligned), it returns the chain changes to apply; its clock is the stream (ms of audio received).
// The rules and constants are the tuner's (../tune): the Noise Removal ladder and caps, the gate's place and gentle
// floors, the cut and pumping verdicts.
import { median } from '../../audio/dsp'
import { gatePassesAll } from '../../plain/refine'
import type { Msg } from '../../plain/types'
import { sameValue, slotAt, withChange } from '../advice/chain'
import { DEFAULT_TUNING_PREFS, type ProcessingAmount } from '../advice/prefs'
import type { AdviceReason, ChainSlot, Change } from '../advice/types'
import { QUIET_SEC as TAKE_QUIET_SEC, RECORD_SEC } from '../autotune/recorder'
import { MIN_SPEECH_SEC } from '../autotune/takeCheck'
import { changeLineMsg } from '../changeMsg'
import { MIN_PAUSE_FRAMES, PAUSE_MARGIN_DB } from '../tune/measure'
import { NOISE_MIN_GAIN_DB } from '../tune/stages'
import { capsOf, type TuneCaps } from '../tune/targets'
import { burstsIn, CAL_FRAME_SEC, FrameCollector, frameDb, heardPausesDb, loudMoment, pausesSilent, quietLevels, speechFrame, talked, type CalFrameLevels, type QuietLevels } from './levels'
import { calReasonMsg, doMsg, noteMsg, noticeMsg } from './msgs'
import { gateFloorStep, gateGentler, gateNeedsProbe, GATE_PASS, gatePlacement, gateUnderSpeech, reafirsOn, removerOf, rungAbove, rungBelow, strengthLadder, type GateValues, type Remover } from './plan'
import { talkCheck, type TalkCheck } from './talkCheck'
import type { CalCommand, CalPhase, CalStreamFrame, CalSummary, CalView } from './types'

/** The quiet phase: this much of the room, seconds. */
export const QUIET_SEC = 5
/** Each change of the set phase is measured on this much of the pauses after it settled, seconds. */
export const SET_MEASURE_SEC = 1.5
/**
 * The talk phase: at least TALK_SEC long with TALK_SPEECH_SEC of speech frames in it, asked again after twice as
 * long, seconds. TALK_SPEECH_SEC is the recording's share (MIN_SPEECH_SEC of speech in its 22 s of talking) of
 * TALK_SEC, to the half second.
 */
export const TALK_SEC = 10
export const TALK_SPEECH_SEC = Math.round(((2 * MIN_SPEECH_SEC * TALK_SEC) / (RECORD_SEC - TAKE_QUIET_SEC))) / 2
export const TALK_MAX_SEC = 2 * TALK_SEC
/** After Elgato Noise Removal is switched on (or its strength moves) its output can be trusted after this, ms. */
export const NR_SETTLE_MS = 700
/** Any other change: the engine's VST3 settle (120 ms) plus one stream frame, ms. */
export const CHANGE_SETTLE_MS = 250
/** A pause counts as long (past a gate's hold and release: the tuner's 300 + 400 ms) this far into it, seconds. */
export const LONG_PAUSE_SEC = 1
/** Talk checks in a row (the first and the gentler versions after a cut) before the words win outright. */
export const MAX_TALK_ROUNDS = 4

interface Touched {
  slot: number
  key: string
  was: number | boolean
}

const targetOf = (slot: number, key: string): string => `${slot}:${key}`

export class NoiseCalibrator {
  /** What was measured and decided, in order (debug; tools/tune-real/calibrate.ts prints it). */
  readonly log: string[] = []
  private phase: CalPhase = 'idle'
  private caps: TuneCaps = capsOf(DEFAULT_TUNING_PREFS.amount)
  private chain: ChainSlot[] = []
  private touched = new Map<string, Touched>()
  private remover: Remover | null = null
  private firs: number[] = []
  private sampleRate = 0
  private clockMs = 0
  private settleUntil = 0
  private lastSeq: number | null = null
  private dropped = 0
  private overruns = 0
  private quiet = new FrameCollector(48000)
  private talk = new FrameCollector(48000, true)
  private speechSec = 0
  private before: QuietLevels | null = null
  private after: QuietLevels | null = null
  private check: TalkCheck | null = null
  private notes: Msg[] = []
  private notice: Msg | null = null
  private detail: Msg | null = null
  private summary: CalSummary | null = null
  private round = 0
  // Noise Removal: its ladder, the rung it sits on, where the pauses first went silent with ReaFIR still on
  private ladder: number[] = []
  private rung = 0
  private reached: number | null = null
  private firOff = false
  private tried: { strength: number; pausesDb: number }[] = []
  private final = false
  // gate: the room peaks it receives, and whether the probe (passing everything) is out
  private inPeakDb = NaN
  private probing = false
  // nudge being verified: the values it moved and what they were
  private nudge: { dir: 'more' | 'less'; back: { slot: number; key: string; to: number }[] } | null = null
  // pauses heard since the last change (done / verify)
  private pauseRun = 0
  private pauseLevels: number[] = []
  private rawDb = NaN
  private processedDb = NaN

  /** Starts on the live chain as it is now (each command it returns is relative to that). `amount`: the Your sound one. */
  start(chain: readonly ChainSlot[], amount: ProcessingAmount = DEFAULT_TUNING_PREFS.amount): CalCommand[] {
    this.reset()
    this.chain = [...chain]
    this.caps = capsOf(amount)
    this.remover = removerOf(chain)
    this.firs = reafirsOn(chain).map((s) => s.index)
    if (!this.remover) return this.finish([], [noteMsg('nothing')])
    this.phase = 'quiet'
    return []
  }

  /** One engine stream frame; returns the changes to apply now. */
  push(f: CalStreamFrame): CalCommand[] {
    if (this.phase === 'idle' || !(f.sampleRate > 0)) return []
    if (f.sampleRate !== this.sampleRate) {
      this.sampleRate = f.sampleRate
      this.quiet = new FrameCollector(f.sampleRate)
      this.talk = new FrameCollector(f.sampleRate, true)
    }
    const { streamDropped, inputOverruns } = f.counters
    const gap = this.lastSeq !== null && (f.seq !== this.lastSeq + 1 || streamDropped > this.dropped || inputOverruns > this.overruns)
    this.lastSeq = f.seq
    this.dropped = streamDropped
    this.overruns = inputOverruns
    const startMs = this.clockMs
    this.clockMs += (f.raw.length / f.sampleRate) * 1000
    if (gap) {
      this.restartWindow()
      this.notice = noticeMsg('gap')
    }
    this.rawDb = frameDb(f.raw)
    this.processedDb = frameDb(f.processed)
    if (!f.settled || f.latencyChanged || startMs < this.settleUntil) return []
    const win = this.phase === 'talk' || this.phase === 'verify' ? this.talk : this.quiet
    return this.step(win.push(f.raw, f.processed))
  }

  /** "More reduction" / "Less reduction" from the result: one step, checked on the next talking. */
  more(): CalCommand[] {
    return this.nudgeBy('more')
  }

  less(): CalCommand[] {
    return this.nudgeBy('less')
  }

  /** Stop midway: everything goes back to how it was before the calibration. */
  cancel(): CalCommand[] {
    if (this.phase === 'idle') return []
    const cmds = this.revertAll()
    this.toIdle(noticeMsg('cancelled'))
    return cmds
  }

  /** "Undo calibration" from the result: everything it changed goes back. */
  undoAll(): CalCommand[] {
    const cmds = this.revertAll()
    this.toIdle(noticeMsg('undone'))
    return cmds
  }

  /** The engine stopped: its chain is gone (Start reloads it from Wave Link), nothing to send. */
  engineStopped(): void {
    if (this.phase === 'idle') return
    this.touched.clear()
    this.toIdle(noticeMsg('engineStopped'))
  }

  get view(): CalView {
    const settling = this.clockMs < this.settleUntil
    const p = this.phase
    let progress = NaN
    let leftSec = NaN
    if (p === 'quiet') {
      progress = this.quiet.seconds / QUIET_SEC
      leftSec = Math.max(0, QUIET_SEC - this.quiet.seconds)
    } else if (p === 'set' && !settling) progress = this.quiet.seconds / SET_MEASURE_SEC
    else if ((p === 'talk' || p === 'verify') && !settling) {
      progress = Math.min(this.talk.seconds / TALK_SEC, this.speechSec / TALK_SPEECH_SEC)
      leftSec = Math.max(0, TALK_SEC - this.talk.seconds)
    }
    const instruction = p === 'quiet' ? doMsg('quiet') : p === 'set' ? doMsg('quietSet') : p === 'talk' || p === 'verify' ? doMsg(this.round ? 'talkAgain' : 'talk') : null
    return {
      phase: p,
      instruction,
      notice: this.notice,
      detail: p === 'set' ? this.detail : null,
      progress: Math.min(1, progress),
      leftSec,
      rawDb: this.rawDb,
      processedDb: this.processedDb,
      summary: this.summary,
      canMore: p === 'done' && this.nudgeMoves('more') !== null,
      canLess: p === 'done' && this.nudgeMoves('less') !== null,
    }
  }

  // ---- phases ----

  private step(frames: readonly CalFrameLevels[]): CalCommand[] {
    switch (this.phase) {
      case 'quiet':
        if (talked(this.quiet.frames)) return this.restartQuiet('talkedQuiet')
        if (this.quiet.seconds < QUIET_SEC) return []
        this.before = quietLevels(this.quiet.frames)
        this.note('quiet', this.before)
        this.quiet.reset()
        this.notice = null
        this.phase = 'set'
        return this.beginSet()
      case 'set': {
        const room = this.before?.roomDb ?? NaN
        if (talked(this.quiet.frames, room)) return this.restartQuiet('talkedSet')
        if (this.quiet.seconds < SET_MEASURE_SEC) return []
        const m = quietLevels(this.quiet.frames)
        this.note(this.detailText(), m)
        this.quiet.reset()
        this.notice = null
        return this.remover?.kind === 'gate' ? this.gateMeasured(m) : this.nrMeasured(m)
      }
      case 'talk':
      case 'verify':
        this.trackPauses(frames)
        return this.talking(frames)
      case 'done':
        this.trackPauses(frames)
        this.quiet.reset()
        return []
      default:
        return []
    }
  }

  private restartQuiet(why: 'talkedQuiet' | 'talkedSet'): CalCommand[] {
    this.quiet.reset()
    this.notice = noticeMsg(why)
    return []
  }

  private talking(frames: readonly CalFrameLevels[]): CalCommand[] {
    const room = this.before?.roomDb ?? NaN
    this.speechSec += frames.filter((f) => speechFrame(f, room)).length * CAL_FRAME_SEC
    if (this.talk.seconds >= TALK_SEC && this.speechSec >= TALK_SPEECH_SEC) {
      const { raw, proc } = this.talk.samples()
      const works = this.remover?.kind === 'nr' && this.isOn(this.remover.slot.index)
      const check = talkCheck(this.talk.frames, raw, proc, this.sampleRate, room, this.longPausesDb(), works)
      this.restartWindow()
      this.notice = null
      this.check = check
      this.log.push(`${this.clockSec()} talk: ${check.speechSec.toFixed(1)} s of speech at ${check.speechDb.toFixed(1)} dBFS (gain ${check.gainDb.toFixed(1)} dB), cut ${(100 * check.cutShare).toFixed(2)} % / ${check.cutEvents.toFixed(2)} per 10 s, pauses between words ${check.pausesDb.toFixed(1)} dBFS, pumping ${check.pumpDb.toFixed(1)} dB${check.cuts ? ' → cuts' : ''}${check.pumps ? ' → pumps' : ''}`)
      return this.phase === 'verify' ? this.verified(check) : this.afterTalk(check)
    }
    if (this.talk.seconds >= TALK_MAX_SEC) {
      this.restartWindow()
      this.notice = noticeMsg('noSpeech')
    }
    return []
  }

  private restartWindow(): void {
    this.quiet.reset()
    this.talk.reset()
    this.speechSec = 0
  }

  /** Changes go out; the windows wait until they settled. */
  private apply(cmds: CalCommand[], settleMs: number): CalCommand[] {
    if (!cmds.length) return cmds
    this.settleUntil = this.clockMs + settleMs
    this.restartWindow()
    this.pauseLevels = []
    this.pauseRun = 0
    return cmds
  }

  private toTalk(): CalCommand[] {
    this.phase = 'talk'
    this.round = 0
    this.restartWindow()
    return []
  }

  private finish(cmds: CalCommand[], notes: Msg[] = []): CalCommand[] {
    this.notes.push(...notes)
    this.phase = 'done'
    this.nudge = null
    this.summary = this.summaryNow()
    return this.apply(cmds, this.remover?.kind === 'nr' ? NR_SETTLE_MS : CHANGE_SETTLE_MS)
  }

  private toIdle(notice: Msg): void {
    this.phase = 'idle'
    this.summary = null
    this.notice = notice
  }

  // ---- set phase: Noise Removal ----

  private beginSet(): CalCommand[] {
    const r = this.remover
    if (!r) return this.finish([], [noteMsg('nothing')])
    return r.kind === 'nr' ? this.nrBegin(r.slot.index) : this.gateBegin(r.slot.index)
  }

  private nrBegin(index: number): CalCommand[] {
    const nr = slotAt(this.chain, index)
    if (!nr || !this.before) return this.finish([])
    this.ladder = strengthLadder(nr, this.caps)
    this.rung = nr.on ? nr.values.strength : this.ladder[0]
    if (nr.on && pausesSilent(this.before)) {
      this.after = this.before
      if (!this.firs.length) return this.finish([], [noteMsg('alreadySilent')])
      this.reached = this.rung
      return this.reafirOff()
    }
    if (nr.on) {
      const next = rungAbove(this.ladder, this.rung)
      if (next === null) return this.finish([], [noteMsg('notReached')])
      return this.toRung(next)
    }
    const on = this.switchTo(index, true, calReasonMsg('nrOn'))
    return this.apply([...(on ? [on] : []), ...this.moves(index, { strength: this.rung }, calReasonMsg('strength'))], NR_SETTLE_MS)
  }

  private toRung(strength: number): CalCommand[] {
    this.rung = strength
    return this.apply(this.moves(this.remover?.slot.index ?? -1, { strength }, calReasonMsg('strength')), NR_SETTLE_MS)
  }

  private reafirOff(): CalCommand[] {
    this.firOff = true
    const cmds = this.firs.flatMap((i) => this.switchTo(i, false, calReasonMsg('firOff')) ?? [])
    return this.apply(cmds, NR_SETTLE_MS)
  }

  private nrMeasured(m: QuietLevels): CalCommand[] {
    this.after = m
    // a strength is as quiet as its pauses are heard: at their loudest burst, when there is one
    this.tried.push({ strength: this.rung, pausesDb: heardPausesDb(m) })
    if (this.final) {
      this.final = false
      return this.toTalk()
    }
    if (pausesSilent(m)) {
      if (!this.firOff && this.firs.length) {
        this.reached = this.rung
        return this.reafirOff()
      }
      return this.toTalk()
    }
    const next = rungAbove(this.ladder, this.rung)
    if (next !== null) return this.toRung(next)
    // the ladder is used up
    const index = this.remover?.slot.index ?? -1
    if (this.firOff && this.reached !== null) {
      // silent only with ReaFIR: it stays on, at the strength that did it
      this.firOff = false
      this.final = true
      this.rung = this.reached
      const back = this.firs.flatMap((i) => this.switchTo(i, true, calReasonMsg('back')) ?? [])
      this.notes.push(noteMsg('keptReafir'))
      return this.apply([...back, ...this.moves(index, { strength: this.reached }, calReasonMsg('strength'))], NR_SETTLE_MS)
    }
    const best = this.tried.reduce((a, b) => (b.pausesDb < a.pausesDb - 1e-9 ? b : a))
    if (this.before && heardPausesDb(this.before) - best.pausesDb >= NOISE_MIN_GAIN_DB) {
      this.notes.push(noteMsg('notReached'))
      if (sameValue(best.strength, this.rung)) return this.toTalk()
      this.final = true
      return this.toRung(best.strength)
    }
    this.after = this.before
    return this.finish(this.revertAll(), [noteMsg('noHelp')])
  }

  // ---- set phase: gate ----

  private gateBegin(index: number): CalCommand[] {
    const g = slotAt(this.chain, index)
    if (!g || !this.before) return this.finish([])
    const on = g.on ? null : this.switchTo(index, true, calReasonMsg('gate'))
    const probe = gateNeedsProbe(this.chain, g)
    const shows = !g.on || gatePassesAll({ wet: g.values.wetDb, dry: g.values.dryDb })
    if (probe && !shows) {
      this.probing = true
      return this.apply([...(on ? [on] : []), ...this.moves(index, GATE_PASS, calReasonMsg('gate'))], CHANGE_SETTLE_MS)
    }
    this.inPeakDb = probe ? this.before.pausesPeakDb : this.before.roomPeakDb
    return this.gatePlace(index, on ? [on] : [])
  }

  private gatePlace(index: number, first: CalCommand[]): CalCommand[] {
    const g = slotAt(this.chain, index)
    if (!g) return this.finish(first)
    return this.apply([...first, ...this.moves(index, gatePlacement(g, this.inPeakDb), calReasonMsg('gate'))], CHANGE_SETTLE_MS)
  }

  private gateMeasured(m: QuietLevels): CalCommand[] {
    if (this.probing) {
      this.probing = false
      this.inPeakDb = m.pausesPeakDb
      return this.gatePlace(this.remover?.slot.index ?? -1, [])
    }
    this.after = m
    return this.toTalk()
  }

  // ---- talk phase ----

  /** What the talking said: cut words → a gentler step and talk again (bounded), else the result. */
  private afterTalk(c: TalkCheck): CalCommand[] {
    const r = this.remover
    if (!r) return this.finish([])
    const more = this.round + 1 < MAX_TALK_ROUNDS
    if (c.cuts) {
      const gentler = more ? this.gentler(r, c) : []
      if (gentler.length) {
        this.round++
        this.notice = noticeMsg('backedOff')
        return this.apply(gentler, r.kind === 'nr' ? NR_SETTLE_MS : CHANGE_SETTLE_MS)
      }
      this.after = this.before
      return this.finish(this.revertAll(), [noteMsg('wouldCut')])
    }
    if (c.pumps && r.kind === 'gate') {
      const g = slotAt(this.chain, r.slot.index)
      const step = more && g ? gateFloorStep(g, 'less') : null
      if (g && step) {
        this.round++
        this.notice = noticeMsg('backedOff')
        return this.apply(this.moves(g.index, step, calReasonMsg('pumping')), CHANGE_SETTLE_MS)
      }
    }
    return this.finish([], c.pumps ? [noteMsg('noiseBetween', { db: Math.round(c.pumpDb) })] : [])
  }

  private gentler(r: Remover, c: TalkCheck): CalCommand[] {
    if (r.kind === 'nr') {
      const below = rungBelow(this.ladder, this.rung)
      if (below === null) return []
      if (!this.notes.some((n) => n.key.endsWith('.wordsFirst'))) this.notes.push(noteMsg('wordsFirst'))
      this.rung = below
      return this.moves(r.slot.index, { strength: below }, calReasonMsg('words'))
    }
    const g = slotAt(this.chain, r.slot.index)
    if (!g) return []
    const inGain = this.before ? this.inPeakDb - this.before.roomPeakDb : 0
    const v = gateUnderSpeech(g, this.inPeakDb, c.quietPeakDb + inGain) ?? gateGentler(g, this.inPeakDb)
    return v ? this.moves(g.index, v, calReasonMsg('words')) : []
  }

  /** After a nudge: More that cut words (or pumped the room with a gate) goes back. */
  private verified(c: TalkCheck): CalCommand[] {
    const n = this.nudge
    if (n?.dir === 'more' && (c.cuts || (c.pumps && this.remover?.kind === 'gate'))) {
      const back = n.back.flatMap((b) => this.moves(b.slot, { [b.key]: b.to }, calReasonMsg('back')))
      this.rung = n.back.find((b) => b.key === 'strength')?.to ?? this.rung
      return this.finish(back, [noteMsg(c.cuts ? 'moreCuts' : 'morePumps')])
    }
    return this.finish([], c.pumps && this.remover?.kind === 'nr' ? [noteMsg('noiseBetween', { db: Math.round(c.pumpDb) })] : [])
  }

  // ---- nudges ----

  private nudgeMoves(dir: 'more' | 'less'): Record<string, number> | null {
    const r = this.remover
    const s = r && slotAt(this.chain, r.slot.index)
    if (!r || !s || !s.on) return null
    if (r.kind === 'nr') {
      const to = dir === 'more' ? rungAbove(this.ladder, s.values.strength) : rungBelow(this.ladder, s.values.strength)
      return to === null ? null : { strength: to }
    }
    if (s.values.wetDb <= -60) return null
    const v: GateValues | null = gateFloorStep(s, dir)
    return v ? Object.fromEntries(Object.entries(v).filter((e): e is [string, number] => typeof e[1] === 'number')) : null
  }

  private nudgeBy(dir: 'more' | 'less'): CalCommand[] {
    const r = this.remover
    const values = this.phase === 'done' ? this.nudgeMoves(dir) : null
    const s = r && slotAt(this.chain, r.slot.index)
    if (!r || !s || !values) return []
    this.nudge = { dir, back: Object.keys(values).map((key) => ({ slot: s.index, key, to: s.values[key] })) }
    if (r.kind === 'nr') this.rung = values.strength
    this.phase = 'verify'
    this.round = 0
    this.notice = null
    return this.apply(this.moves(s.index, values, calReasonMsg(dir)), r.kind === 'nr' ? NR_SETTLE_MS : CHANGE_SETTLE_MS)
  }

  // ---- the chain as calibrated ----

  private isOn(index: number): boolean {
    return slotAt(this.chain, index)?.on ?? false
  }

  /** One command per value that moves; a value back where it was before the calibration is a revert. */
  private moves(index: number, values: Readonly<Record<string, number | undefined>>, title: Msg): CalCommand[] {
    const out: CalCommand[] = []
    for (const [key, to] of Object.entries(values)) {
      if (to === undefined) continue
      const s = slotAt(this.chain, index)
      const now = s?.values[key]
      if (!s || now === undefined || sameValue(now, to)) continue
      const target = targetOf(index, key)
      const was = this.touched.get(target)?.was ?? now
      const step: Change = { id: `calibrate:${target}`, reason: reasonOf(title), titleMsg: title, kind: 'value', slot: index, key, from: now, to }
      this.detail = changeLineMsg(s, step)
      this.chain = withChange(this.chain, step)
      if (key === 'dryDb' && this.phase !== 'set' && this.after && s.kind === 'reagate') this.after = { ...this.after, pausesDb: this.after.pausesDb + to - now, pausesLoudDb: this.after.pausesLoudDb + to - now }
      if (typeof was === 'number' && sameValue(was, to)) {
        this.touched.delete(target)
        out.push({ kind: 'revert', target })
        continue
      }
      if (!this.touched.has(target)) this.touched.set(target, { slot: index, key, was })
      const change = { ...step, from: typeof was === 'number' ? was : now }
      out.push({ kind: 'set', target, change: { ...change, reason: reasonOf(title), changeMsg: changeLineMsg(s, change) } })
    }
    return out
  }

  private switchTo(index: number, on: boolean, title: Msg): CalCommand | null {
    const s = slotAt(this.chain, index)
    if (!s || s.on === on) return null
    const target = targetOf(index, 'on')
    const was = this.touched.get(target)?.was ?? s.on
    const step: Change = { id: `calibrate:${target}`, reason: reasonOf(title), titleMsg: title, kind: 'switch', slot: index, on }
    this.detail = changeLineMsg(s, step)
    this.chain = withChange(this.chain, step)
    if (was === on) {
      this.touched.delete(target)
      return { kind: 'revert', target }
    }
    if (!this.touched.has(target)) this.touched.set(target, { slot: index, key: 'on', was })
    return { kind: 'set', target, change: { ...step, reason: reasonOf(title), changeMsg: changeLineMsg(s, step) } }
  }

  /** Every value the calibration moved goes back, last first. */
  private revertAll(): CalCommand[] {
    const out: CalCommand[] = []
    for (const [target, t] of [...this.touched].reverse()) {
      const change: Change =
        t.key === 'on'
          ? { id: 'calibrate:revert', reason: 'undo', titleMsg: calReasonMsg('back'), kind: 'switch', slot: t.slot, on: t.was === true }
          : { id: 'calibrate:revert', reason: 'undo', titleMsg: calReasonMsg('back'), kind: 'value', slot: t.slot, key: t.key, from: 0, to: Number(t.was) }
      this.chain = withChange(this.chain, change)
      out.push({ kind: 'revert', target })
    }
    this.touched.clear()
    return out
  }

  // ---- the result ----

  /**
   * Long pauses heard since the last change settled (talk, done, verify): frames LONG_PAUSE_SEC into a stretch at the
   * room's level, past a gate's hold and release.
   */
  private trackPauses(frames: readonly CalFrameLevels[]): void {
    const room = this.before?.roomDb ?? NaN
    for (const f of frames) {
      this.pauseRun = f.rawDb <= room + PAUSE_MARGIN_DB ? this.pauseRun + 1 : 0
      if (this.pauseRun * CAL_FRAME_SEC > LONG_PAUSE_SEC) this.pauseLevels.push(f.procDb)
    }
    if (this.pauseLevels.length > 4 * MIN_PAUSE_FRAMES) this.pauseLevels.splice(0, this.pauseLevels.length - 4 * MIN_PAUSE_FRAMES)
    if (this.summary && this.pauseLevels.length >= MIN_PAUSE_FRAMES) {
      const afterDb = median(this.pauseLevels)
      const loud = { pausesDb: afterDb, pausesLoudDb: loudMoment(this.pauseLevels) }
      this.summary = { ...this.summary, afterDb, silent: pausesSilent(loud), notes: this.notesWith(loud) }
    }
  }

  /**
   * The processed long pauses for the current settings: heard since the last change when there were enough, else the
   * set phase's measurement, moved with any gate floor change since (a closed gate plays its input at Dry).
   */
  private longPausesDb(): number {
    if (this.pauseLevels.length >= MIN_PAUSE_FRAMES) return median(this.pauseLevels)
    return (this.after ?? this.before)?.pausesDb ?? NaN
  }

  private summaryNow(): CalSummary {
    const b = this.before
    const a = this.after ?? b
    const changes: Msg[] = []
    for (const t of this.touched.values()) {
      const s = slotAt(this.chain, t.slot)
      if (!s) continue
      const c: Change =
        t.key === 'on'
          ? { id: 'calibrate', reason: 'undo', titleMsg: calReasonMsg('back'), kind: 'switch', slot: t.slot, on: s.on }
          : { id: 'calibrate', reason: 'undo', titleMsg: calReasonMsg('back'), kind: 'value', slot: t.slot, key: t.key, from: Number(t.was), to: s.values[t.key] }
      changes.push(changeLineMsg(s, c))
    }
    return {
      roomDb: b?.roomDb ?? NaN,
      beforeDb: b?.pausesDb ?? NaN,
      afterDb: a?.pausesDb ?? NaN,
      silent: a ? pausesSilent(a) : false,
      changes,
      cutShare: this.check?.cutShare ?? NaN,
      cutEvents: this.check?.cutEvents ?? NaN,
      pumpDb: this.check?.pumpDb ?? NaN,
      notes: this.notesWith(a),
    }
  }

  /** The result's notes, and one when the pauses as heard still carry bursts (the room let through now and then). */
  private notesWith(q: Pick<QuietLevels, 'pausesDb' | 'pausesLoudDb'> | null): Msg[] {
    return q && burstsIn(q) ? [...this.notes, noteMsg('bursts', { db: q.pausesLoudDb })] : [...this.notes]
  }

  private clockSec(): string {
    return `${(this.clockMs / 1000).toFixed(1)} s`
  }

  private detailText(): string {
    const r = this.remover
    const s = r && slotAt(this.chain, r.slot.index)
    if (!s) return 'set'
    const fir = this.firs.length ? `, ReaFIR ${this.firs.every((i) => this.isOn(i)) ? 'on' : 'off'}` : ''
    return r.kind === 'nr' ? `strength ${s.values.strength}${fir}` : `gate threshold ${s.values.thresholdDb} dB, Wet ${s.values.wetDb}, Dry ${s.values.dryDb} dB`
  }

  private note(what: string, m: QuietLevels): void {
    this.log.push(`${this.clockSec()} ${what}: room ${m.roomDb.toFixed(1)} dBFS (peaks ${m.roomPeakDb.toFixed(1)}), pauses heard ${m.pausesDb.toFixed(1)} dBFS (peaks ${m.pausesPeakDb.toFixed(1)}, loudest moment ${m.pausesLoudDb.toFixed(1)}${burstsIn(m) ? ': bursts' : ''}, ${(100 * m.silentShare).toFixed(0)} % digital silence)`)
  }

  private reset(): void {
    this.log.length = 0
    this.phase = 'idle'
    this.touched.clear()
    this.remover = null
    this.firs = []
    this.clockMs = 0
    this.settleUntil = 0
    this.lastSeq = null
    this.dropped = 0
    this.overruns = 0
    this.restartWindow()
    this.before = null
    this.after = null
    this.check = null
    this.notes = []
    this.notice = null
    this.detail = null
    this.summary = null
    this.round = 0
    this.ladder = []
    this.rung = 0
    this.reached = null
    this.firOff = false
    this.tried = []
    this.final = false
    this.inPeakDb = NaN
    this.probing = false
    this.nudge = null
    this.pauseRun = 0
    this.pauseLevels = []
  }
}

/** The Advice reason of a calibration change: noise moves are noisyPause, the gentler steps for words deadSilence. */
function reasonOf(title: Msg): AdviceReason {
  return /\.(words|pumping|less|back)$/.test(title.key) ? 'deadSilence' : 'noisyPause'
}
