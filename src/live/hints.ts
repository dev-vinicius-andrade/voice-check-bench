// Plain hints for live tuning (SPEC "Live tuning (v1.3)"): what to turn in Wave Link right now, most important first.
// Pure. Msg keys under live.hint.* (English and pt-BR source strings: ./hintStrings.ts). Thresholds reuse the level
// check (diagnose) and the refinement loop (refine) wherever a matching number exists.
import { LEVEL_GOOD_MAX, LEVEL_GOOD_MIN, PEAK_WARN_DB, TARGET_SPEECH_DB } from '../audio/diagnose'
import { CHOPPED_ZERO, CLIP_MIN_DROP_DB, HARSH_K } from '../plain/refine'
import type { Msg } from '../plain/types'
import { MIN_TALK_SEC } from './metrics'
import type { LiveMetrics } from './types'

/** At most this many hints at a time. */
export const MAX_HINTS = 4
/** With a raw mic, a window whose sync is below this means the two inputs don't line up. */
export const NO_SYNC = 0.3
/** Level-matched pause noise must drop at least this much below the raw mic's, dB, or the noise isn't being reduced. */
export const NOT_REDUCED_DB = 6
/** Below this the room is quiet anyway (the noise check's good limit), so "not reduced" is not worth saying, dBFS. */
export const QUIET_ROOM_DB = -70
/** Pauses on the output louder than this still sound noisy, dBFS. */
export const NOISY_PAUSE_DB = -50
/** A band this far from the goal (either way) gets an EQ hint, dB. */
export const TONE_HINT_DB = 4
/** EQ changes suggested by a tone hint never exceed this, dB. */
export const TONE_MAX_DB = 6

/** Tone bands with a hint, BANDS index → key (ReaEQ: Low Shelf 150 Hz, Band 250 Hz, Band 450 Hz, Band 3500 Hz, High Shelf 10 kHz). */
export const TONE_BANDS = [
  { band: 1, key: 'boom' },
  { band: 2, key: 'warmth' },
  { band: 3, key: 'mud' },
  { band: 6, key: 'presence' },
  { band: 7, key: 'sibilance' },
] as const

/** Raw input peak below this while the Wave Link output has talk: the raw device is the wrong one, dBFS. */
export const RAW_SILENT_DB = -60

const hint = (key: string, params?: Msg['params']): Msg => (params ? { key: `live.hint.${key}`, params } : { key: `live.hint.${key}` })
const r05 = (v: number): number => Math.round(v * 2) / 2 || 0
const finite = Number.isFinite

/**
 * Hints for the latest metrics, at most MAX_HINTS, in this order: inputs out of sync · too loud / too quiet · dead
 * silence · pause noise (not reduced, else still noisy) · tone bands, biggest deviation first.
 * With less than MIN_TALK_SEC of talk the only hint is "keep talking".
 */
export function liveHints(m: LiveMetrics): Msg[] {
  if (!(m.talkSec >= MIN_TALK_SEC)) return [hint('talkMore')]
  const out: Msg[] = []
  const fx = m.fx
  const raw = m.raw

  // the raw input stays near silent while the person talks: the wrong device is picked as the raw mic
  if (raw && raw.peakDb < RAW_SILENT_DB) out.push(hint('rawSilent'))
  else if (raw && !(m.sync >= NO_SYNC)) out.push(hint('noRawSync'))

  // level: too loud wins (clipping distorts whatever the median says)
  const clipped = fx.clipFrames > 0 || fx.peakDb >= PEAK_WARN_DB
  if (clipped || fx.speechDb > LEVEL_GOOD_MAX) {
    const over = finite(fx.speechDb) ? Math.ceil(fx.speechDb - TARGET_SPEECH_DB) : 0
    out.push(hint('tooLoud', { db: Math.max(1, over, clipped ? CLIP_MIN_DROP_DB : 0) }))
  } else if (fx.speechDb < LEVEL_GOOD_MIN) {
    out.push(hint('tooQuiet', { db: Math.max(1, Math.floor(TARGET_SPEECH_DB - fx.speechDb)) }))
  }

  const dead = fx.deadSilence > CHOPPED_ZERO
  if (dead) out.push(hint('deadSilence'))

  if (finite(fx.pauseDb)) {
    let notReduced = false
    if (raw && finite(raw.pauseDb) && fx.pauseDb >= QUIET_ROOM_DB) {
      // level-matched: the gain the effects add to everything (compressor Wet) is not "more noise"
      const gain = finite(fx.speechDb) && finite(raw.speechDb) ? fx.speechDb - raw.speechDb : 0
      notReduced = fx.pauseDb - gain > raw.pauseDb - NOT_REDUCED_DB
    }
    if (notReduced) out.push(hint('noiseNotReduced'))
    else if (fx.pauseDb > NOISY_PAUSE_DB && !dead) out.push(hint('stillNoisy'))
  }

  const tone = TONE_BANDS.map((b) => ({ ...b, dev: fx.tone[b.band] }))
    .filter((t) => finite(t.dev) && Math.abs(t.dev) >= TONE_HINT_DB)
    .sort((a, b) => Math.abs(b.dev) - Math.abs(a.dev))
  for (const t of tone) {
    const db = Math.min(TONE_MAX_DB, r05(Math.abs(t.dev) * HARSH_K))
    out.push(hint(`${t.dev > 0 ? 'toneHigh' : 'toneLow'}.${t.key}`, { db }))
  }

  return out.slice(0, MAX_HINTS)
}
