// Peaks are a hard limit, not a trade: the final render ends at or under the peak ceiling whenever a lower make-up
// gain can get it there. A peak over 0 dBFS clips in Wave Link (heard as crackling), whatever the speech level is.
import { adb } from '../../audio/dsp'
import { GATE_MIN_DB, gatePassesAll } from '../../plain/refine'
import type { Measured, TakeMask } from './measure'
import { reasonMsg } from './msgs'
import { REGRESS_TOL, scoreOf } from './score'
import type { Move, Session } from './session'
import { COMP_DEEPER_DB, COMP_THRESHOLD_RANGE, levelStage } from './stages'

/** The make-up Wet may go this low for the peaks (the level stages stop at 0 dB), dB. */
export const PEAK_WET_MIN_DB = -24
/** The compressor's fastest attack the tuner sets, ms. */
export const ATTACK_MIN_MS = 1
/** A move against the spikes must take this much off the crest (peak over speech level), dB. */
export const CREST_MIN_GAIN_DB = 0.5
/** A spike: a 10 ms frame whose peak is within this of the highest, dB; right after silence when the 100 ms before it sit this far under it. */
export const SPIKE_WITHIN_DB = 3
export const ONSET_UNDER_DB = 30
/** The peak may end this far over the ceiling and still count as inside (measurement grain), dB. */
export const PEAK_TOL_DB = 0.05
/** Marks a run whose make-up gain was taken down for the peaks (Session.refused): a voice under the target is their doing. */
export const PEAK_HELD = 'peaks hold the level'

/** Where a render's highest peaks are: how many 10 ms frames come within SPIKE_WITHIN_DB of the top, and how many of them are word starts right after (near) silence. */
export function peakSpots(mask: Pick<TakeMask, 'sampleRate'>, audio: Float32Array): { spikes: number; onsets: number } {
  const w = Math.round(0.01 * mask.sampleRate)
  const n = Math.floor(audio.length / w)
  const peak = new Float32Array(n)
  const power = new Float64Array(n)
  let top = 0
  for (let f = 0; f < n; f++) {
    let p = 0
    let e = 0
    for (let i = f * w; i < (f + 1) * w; i++) {
      const v = Math.abs(audio[i])
      if (v > p) p = v
      e += v * v
    }
    peak[f] = p
    power[f] = e / w
    if (p > top) top = p
  }
  let spikes = 0
  let onsets = 0
  for (let f = 0; f < n; f++) {
    if (!(peak[f] > 0) || adb(peak[f]) < adb(top) - SPIKE_WITHIN_DB) continue
    spikes++
    let e = 0
    for (let k = Math.max(0, f - 10); k < f; k++) e += power[k]
    if (f >= 10 && adb(Math.sqrt(e / 10) + 1e-12) <= adb(peak[f]) - ONSET_UNDER_DB) onsets++
  }
  return { spikes, onsets }
}

const crest = (m: Measured): number => m.peakDb - m.speechDb

/**
 * The last stage. While the kept render's peak is over the ceiling (targets.peakCeilDb), in this order, one render
 * each, a step kept only when it measures better:
 * 1. the last ReaComp's attack down to ATTACK_MIN_MS (a slow attack lets the start of a word through before the
 *    compressor acts, and the make-up gain multiplies it);
 * 2. its threshold COMP_DEEPER_DB lower and its ratio up to the amount's cap;
 * 3. when most spikes are word starts right after silence and a Noise Removal is on: its strength one step lower
 *    (digital silence → voice is the steepest onset a compressor can get);
 *    — each of these is kept when the crest (peak over speech level) came down CREST_MIN_GAIN_DB and nothing was
 *    damaged for it;
 * 4. the make-up Wet down by what the peak is still over, as far as PEAK_WET_MIN_DB, until it fits (a working gate
 *    after it follows). This one is not weighed against anything: a quieter voice is said in the result
 *    (unmet.level.peaks), a peak over the ceiling distorts.
 */
export async function peakStage(s: Session): Promise<void> {
  const t = s.targets
  const over = (m: Measured): boolean => m.peakDb > t.peakCeilDb + PEAK_TOL_DB
  if (s.m.silent || !Number.isFinite(s.m.peakDb) || !over(s.m)) return
  const spots = peakSpots(s.mask, s.audio)
  s.note('trim', 'info', `peak ${s.m.peakDb.toFixed(1)} dBFS over the ceiling ${t.peakCeilDb.toFixed(1)}: ${crest(s.m).toFixed(1)} dB over the speech level, ${spots.onsets} of ${spots.spikes} spike(s) right after silence`)

  /** One candidate: rendered, kept when `better` says so. */
  const attempt = async (moves: Move[], better: (b: Measured, a: Measured) => boolean): Promise<boolean> => {
    const set = s.withMoves('trim', moves)
    if (!set) return false
    if (s.left('trim') < 1) {
      s.outOfBudget = true
      return false
    }
    const { audio, m } = await s.render('trim', set)
    s.cut(set, audio, m, s.m)
    const ok = better(s.m, m)
    const text = moves.map((mv) => `${mv.slot.kind}[${mv.slot.index}].${mv.key} → ${mv.to}`).join(', ')
    s.note('trim', ok ? 'keep' : 'revert', `#${s.renders} ${text}: peak ${s.m.peakDb.toFixed(1)} → ${m.peakDb.toFixed(1)} dBFS, speech ${s.m.speechDb.toFixed(1)} → ${m.speechDb.toFixed(1)} dBFS`, scoreOf(m, t, s.trim(set)))
    if (!ok) return false
    s.set = set
    s.audio = audio
    s.m = m
    return true
  }
  const calmer = (b: Measured, a: Measured): boolean => !a.silent && crest(a) <= crest(b) - CREST_MIN_GAIN_DB && scoreOf(a, t).damage <= scoreOf(b, t).damage + REGRESS_TOL

  const start = s.set
  const comp = s.live('reacomp', 'wetDb').at(-1)
  if (comp && Number.isFinite(comp.values.attackMs) && s.value(comp, 'attackMs') > ATTACK_MIN_MS) {
    await attempt([{ slot: comp, key: 'attackMs', to: ATTACK_MIN_MS, reason: 'tooLoud', titleMsg: reasonMsg('peak.attack', { to: ATTACK_MIN_MS }), metric: 'peakDb' }], calmer)
  }
  if (over(s.m) && comp && Number.isFinite(comp.values.thresholdDb) && Number.isFinite(comp.values.ratio)) {
    const threshold = Math.max(COMP_THRESHOLD_RANGE[0], s.value(comp, 'thresholdDb') - COMP_DEEPER_DB)
    const ratio = Math.max(s.value(comp, 'ratio'), Math.round(t.caps.ratio * 10) / 10)
    await attempt(
      [
        { slot: comp, key: 'thresholdDb', to: threshold, reason: 'tooLoud', titleMsg: reasonMsg('peak.comp', { to: threshold }), metric: 'peakDb' },
        { slot: comp, key: 'ratio', to: ratio, reason: 'tooLoud', titleMsg: reasonMsg('peak.comp', { to: threshold }), metric: 'peakDb' },
      ],
      calmer,
    )
  }
  const nr = s.live('noiseRemoval', 'strength').at(0)
  if (over(s.m) && nr && spots.spikes > 0 && spots.onsets * 2 >= spots.spikes) {
    const to = Math.max(0, s.value(nr, 'strength') - t.caps.nrStep)
    if (to < s.value(nr, 'strength')) await attempt([{ slot: nr, key: 'strength', to, reason: 'tooLoud', titleMsg: reasonMsg('peak.strength', { to }), metric: 'peakDb' }], calmer)
  }
  // what the compressor now holds back the make-up gain may give back to the voice, as far as the ceiling allows
  if (s.set !== start) await levelStage(s, 'trim')
  for (let pass = 0; pass < 4 && comp && over(s.m); pass++) {
    const wet = s.value(comp, 'wetDb')
    const to = Math.max(PEAK_WET_MIN_DB, Math.floor((wet - (s.m.peakDb - t.peakCeilDb)) * 2) / 2)
    if (!(to < wet)) break
    const follow: Move[] = s
      .live('reagate', 'thresholdDb', 'wetDb', 'dryDb')
      .filter((g) => g.index > comp.index && !gatePassesAll({ wet: s.value(g, 'wetDb'), dry: s.value(g, 'dryDb') }))
      .map((g) => ({ slot: g, key: 'thresholdDb', to: Math.max(GATE_MIN_DB, s.value(g, 'thresholdDb') + (to - wet)), reason: 'tooLoud', titleMsg: reasonMsg('level.gateFollows', { db: wet - to }), metric: 'speechDb' }))
    const title = reasonMsg('level.peaks', { from: s.m.speechDb, target: t.speechDb, peak: s.m.peakDb, db: wet - to })
    if (!(await attempt([{ slot: comp, key: 'wetDb', to, reason: 'tooLoud', titleMsg: title, metric: 'peakDb' }, ...follow], (b, a) => a.peakDb < b.peakDb))) break
    s.refused.add(PEAK_HELD)
  }
}
