// "Try this" advice (SPEC "Desktop app (v2.0)" → Tuning): held live metrics + the live chain → concrete value changes.
// Pure, framework-free. Rules and numbers come from the refinement loop (src/plain/refine.ts), the level/peak checks
// (src/audio/diagnose.ts), the live hints (src/live/hints.ts) and the guide's EQ (src/settings/suggest.ts via ./tone.ts).
import { LEVEL_GOOD_MAX, LEVEL_GOOD_MIN, PEAK_WARN_DB, TARGET_SPEECH_DB } from '../../audio/diagnose'
import type { HeldMetrics } from '../../live/hold'
import {
  CHOPPED_ZERO,
  CLIP_MIN_DROP_DB,
  GATE_MIN_DB,
  GATE_SOFT_DRY_DB,
  GATE_STEP_DB,
  WET_CAP,
  gateDoubles,
  gatePassesAll,
  openGainDb,
} from '../../plain/refine'
import { DEFAULT_GOAL, type VoiceGoal } from '../../types'
import { slotsWith } from './chain'
import { changeTarget, dbChangeMsg, strengthChangeMsg, titleMsg, valueAdvice } from './msgs'
import { toneAdvice } from './tone'
import type { Advice, ChainSlot } from './types'

/**
 * Noise Removal strength step (0..100 = VAD Threshold × 100) when pauses drop to dead silence. The spike measured
 * the default 85 gating pauses to digital silence and 0 leaving them at −45 dB (quiet, never dead), with the voice
 * unchanged (spike/vst3-probe/FINDINGS.md, step 4). A fixed 20 crosses that range from the default in at most five
 * taps (85 → 65 → 45 → 25 → 5 → 0), each one big enough to hear; halving (the ReaFIR rule) would crawl near 0.
 */
export const NR_STEP = 20

export interface AdviseOptions {
  /**
   * Caller's clock (ms, the one given to holdMetrics): advise only from speech heard at or after this time, e.g. the
   * last applied change, so values measured before it are not advised on twice.
   */
  notBeforeMs?: number
}

const r05 = (v: number): number => Math.round(v * 2) / 2 || 0

/**
 * Advice for the processed side, most important first: doubled ReaGate (Dry → −20) · too loud (Wet down to −21 dBFS,
 * at least 3 dB when it clipped) · dead silence (Noise Removal −20, else ReaGate Threshold −10) · too quiet (Wet up,
 * cap 18) · tone vs the goal (ReaEQ bands, biggest deviation first). Only on values present in switched-on slots, at most
 * one change per (slot, key) (the more important advice wins). Empty while nothing was heard yet (heardAtMs null).
 */
export function advise(held: HeldMetrics, chain: readonly ChainSlot[], goal: VoiceGoal = DEFAULT_GOAL, opts: AdviseOptions = {}): Advice[] {
  const fx = held.fx
  if (fx.heardAtMs === null) return []
  if (opts.notBeforeMs !== undefined && fx.heardAtMs < opts.notBeforeMs) return []
  const out: Advice[] = []
  const used = new Set<string>()
  const push = (a: Advice): void => {
    const t = changeTarget(a)
    if (used.has(t)) return
    used.add(t)
    out.push(a)
  }

  // doubled gate: Wet and Dry both open add the voice twice; Dry goes to the soft gate's −20 (refine 'gateDoubled')
  let gateCutDb = 0
  for (const g of slotsWith(chain, 'reagate', 'wetDb', 'dryDb')) {
    const gate = { wet: g.values.wetDb, dry: g.values.dryDb }
    if (!gateDoubles(gate)) continue
    gateCutDb += openGainDb(gate) - openGainDb({ wet: gate.wet, dry: GATE_SOFT_DRY_DB })
    push(valueAdvice('gateDoubled', g, 'dryDb', GATE_SOFT_DRY_DB, titleMsg('gateDoubled', { from: gate.dry, to: GATE_SOFT_DRY_DB }), dbChangeMsg(g, 'Dry', gate.dry, GATE_SOFT_DRY_DB)))
  }

  // level: the last switched-on ReaComp's Wet is the last gain stage; whatever the gate fix takes off counts (as refine)
  const comp = slotsWith(chain, 'reacomp', 'wetDb').at(-1)
  const clipped = fx.clipFrames > 0 || fx.peakDb >= PEAK_WARN_DB
  const speech = fx.speechDb - gateCutDb
  if (comp && (clipped || speech > LEVEL_GOOD_MAX)) {
    const wet = comp.values.wetDb
    const over = Number.isFinite(speech) ? Math.ceil(speech - TARGET_SPEECH_DB) : 0
    const drop = Math.max(over, clipped ? Math.ceil(CLIP_MIN_DROP_DB - gateCutDb) : 0, 0)
    // never below 0 dB: the Wet is make-up gain (refine; below that the mic gain is what must come down)
    const to = Math.max(0, r05(wet - drop))
    if (to < wet) push(valueAdvice('tooLoud', comp, 'wetDb', to, titleMsg('tooLoud', { db: wet - to, target: TARGET_SPEECH_DB }), dbChangeMsg(comp, 'Wet', wet, to)))
  }

  // dead silence in pauses: the noise remover lower first, else the gate opens 10 dB earlier (not below −72)
  if (fx.deadSilence > CHOPPED_ZERO) {
    const nr = slotsWith(chain, 'noiseRemoval', 'strength').find((s) => s.values.strength > 0)
    const gate = slotsWith(chain, 'reagate', 'thresholdDb', 'wetDb', 'dryDb').find(
      (g) => !gatePassesAll({ wet: g.values.wetDb, dry: g.values.dryDb }) && g.values.thresholdDb > GATE_MIN_DB,
    )
    if (nr) {
      const from = nr.values.strength
      const to = Math.max(0, Math.round(from - NR_STEP))
      push(valueAdvice('deadSilence', nr, 'strength', to, titleMsg('deadSilence.noiseRemoval'), strengthChangeMsg(nr, from, to)))
    } else if (gate) {
      const from = gate.values.thresholdDb
      const to = Math.max(GATE_MIN_DB, from - GATE_STEP_DB)
      push(valueAdvice('deadSilence', gate, 'thresholdDb', to, titleMsg('deadSilence.gate', { db: from - to }), dbChangeMsg(gate, 'Threshold', from, to)))
    }
  }

  // too quiet: Wet makes up the level toward −21 dBFS, never past it and never above 18 dB
  if (comp && !clipped && Number.isFinite(speech) && speech < LEVEL_GOOD_MIN) {
    const wet = comp.values.wetDb
    const raise = Math.floor(TARGET_SPEECH_DB - speech)
    const to = Math.min(WET_CAP, r05(wet + raise))
    if (raise >= 1 && to > wet) push(valueAdvice('tooQuiet', comp, 'wetDb', to, titleMsg('tooQuiet', { db: to - wet, target: TARGET_SPEECH_DB }), dbChangeMsg(comp, 'Wet', wet, to)))
  }

  for (const a of toneAdvice(fx.tone, chain, goal, clipped)) push(a)
  return out
}
