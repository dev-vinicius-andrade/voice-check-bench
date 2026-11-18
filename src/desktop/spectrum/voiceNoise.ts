// Voice and noise of a recorded take apart (SPEC "Tune from a recording — voice and noise"). Framework-free.
// CONTRACT: the signatures and their meaning are fixed (the result step's hooks are written against them).
// The noise is measured where the person is not talking (the quiet lead and the tuner mask's pause frames), the voice
// over the mask's speech windows with the noise taken out in power. Spectra use the plot's own FFT frames
// (display.ts), averaged and read on the plot's points like the take analyzer's whole-take curves (take.ts).
import { hann } from '../../audio/dsp'
import { QUIET_SEC } from '../../audio/reference'
import { FFT_N, NOISE_FLOOR_SHARE, prepareTake, type TakeMask } from '../tune/measure'
import { DISPLAY_FFT, DISPLAY_HOP, DisplaySpectrum, spectrumFreqs } from './display'
import { FLOOR_DB, Framer, powDb } from './framer'

/** A stretch of the take, in samples: [from, to). */
export interface Stretch {
  from: number
  to: number
}

/** Noise this many dB under the voice level or closer is marked as audible. */
export const AUDIBLE_UNDER_DB = 30

/** Shortest noise stretch kept, seconds. */
export const MIN_STRETCH_SEC = 0.2
/** Linear fade at each end of a stretch in noiseOnly(), seconds. */
export const NOISE_FADE_SEC = 0.01
/**
 * The voice spectrum (speech power minus noise power, per FFT bin) never goes under this share of the speech power
 * (−10 dB): the tuner's own floor for the same subtraction (measure.ts NOISE_FLOOR_SHARE).
 */
export const VOICE_FLOOR_SHARE = NOISE_FLOOR_SHARE
/** Region edges, Hz: low under LOW_MID_HZ, mid up to MID_HIGH_HZ, high above it (up to Nyquist). */
export const LOW_MID_HZ = 250
export const MID_HIGH_HZ = 4000

export type NoiseRegionId = 'low' | 'mid' | 'high'

/** The noise in one part of the spectrum: low (under 250 Hz), mid (250 Hz–4 kHz), high (over 4 kHz). */
export interface NoiseRegion {
  id: NoiseRegionId
  loHz: number
  hiHz: number
  /** Level of the noise in this region over the noise stretches, dBFS (RMS). −200 when silent. */
  noiseDb: number
  /** How far that is under the voice level (voiceLevelDb − noiseDb), dB. */
  underVoiceDb: number
}

export interface VoiceNoise {
  /** The plot's frequency points (SPECTRUM_POINTS, same as LiveSpectrum.freqsHz). */
  freqsHz: Float32Array
  /** Average spectrum while talking, with the noise spectrum subtracted in power (floored), dBFS per plot point. */
  voiceDb: Float32Array
  /** Average spectrum over the noise stretches, dBFS per plot point (same scale as the take analyzer's curves). */
  noiseDb: Float32Array
  /** Level of the audio while talking and over the noise stretches, dBFS (RMS). */
  voiceLevelDb: number
  noiseLevelDb: number
  /** low, mid, high, in this order. */
  regions: NoiseRegion[]
}

/** The raw take's fixed frames (the tuner's mask), analysed once per take and sample rate. */
const masks = new WeakMap<Float32Array, { sampleRate: number; mask: TakeMask | null }>()
function maskOf(take: Float32Array, sampleRate: number): TakeMask | null {
  const hit = masks.get(take)
  if (hit && hit.sampleRate === sampleRate) return hit.mask
  const mask = prepareTake(take, sampleRate)
  masks.set(take, { sampleRate, mask })
  return mask
}

/** Stretches clamped to [0, n), empty ones dropped, sorted, overlapping or touching ones merged. */
function cleaned(stretches: readonly Stretch[], n: number): Stretch[] {
  const out: Stretch[] = []
  const sorted = stretches
    .filter((s) => Number.isFinite(s.from) && Number.isFinite(s.to))
    .map((s) => ({ from: Math.max(0, Math.floor(s.from)), to: Math.min(n, Math.floor(s.to)) }))
    .filter((s) => s.to > s.from)
    .sort((a, b) => a.from - b.from)
  for (const s of sorted) {
    const last = out[out.length - 1]
    if (last && s.from <= last.to) last.to = Math.max(last.to, s.to)
    else out.push(s)
  }
  return out
}

/** `spans` (sorted, disjoint) without any sample of `cut` (sorted, disjoint). */
function without(spans: readonly Stretch[], cut: readonly Stretch[]): Stretch[] {
  const out: Stretch[] = []
  for (const s of spans) {
    let from = s.from
    for (const c of cut) {
      if (c.to <= from || c.from >= s.to) continue
      if (c.from > from) out.push({ from, to: c.from })
      from = Math.max(from, c.to)
    }
    if (from < s.to) out.push({ from, to: s.to })
  }
  return out
}

/** Average power spectrum (framer.ts units) of the display FFT frames that lie wholly inside `spans`. */
function averagePower(x: Float32Array, spans: readonly Stretch[]): { power: Float64Array; count: number } {
  const power = new Float64Array(DISPLAY_FFT / 2 + 1)
  let count = 0
  const framer = new Framer(DISPLAY_FFT, DISPLAY_HOP, (p) => {
    for (let k = 0; k < p.length; k++) power[k] += p[k]
    count++
  })
  for (const s of spans) {
    framer.reset()
    framer.push(x.subarray(s.from, s.to))
  }
  if (count > 0) for (let k = 0; k < power.length; k++) power[k] /= count
  return { power, count }
}

/** An average power spectrum read on the plot's points, as the take analyzer reads its whole-take average. */
function plotDb(power: Float64Array, count: number, freqsHz: Float32Array, sampleRate: number): Float32Array {
  const out = new Float32Array(freqsHz.length).fill(FLOOR_DB)
  if (count === 0) return out
  const d = new DisplaySpectrum(freqsHz, sampleRate)
  d.pushPower(power)
  out.set(d.db)
  return out
}

/** Mean-square level of `x` over `spans`, dBFS. */
function levelDb(x: Float32Array, spans: readonly Stretch[]): number {
  let s = 0
  let c = 0
  for (const sp of spans) {
    for (let i = sp.from; i < sp.to; i++) s += x[i] * x[i]
    c += sp.to - sp.from
  }
  return c > 0 ? powDb(s / c) : FLOOR_DB
}

/**
 * Factor from a sum of one-sided framer.ts power (interior bins counted twice) to the mean square of the signal
 * (Parseval with the Hann window): (Σw)² / (4 · N · Σw²), about 1/6.
 */
const PARSEVAL = ((): number => {
  const w = hann(DISPLAY_FFT)
  let s1 = 0
  let s2 = 0
  for (let i = 0; i < w.length; i++) {
    s1 += w[i]
    s2 += w[i] * w[i]
  }
  return (s1 * s1) / (4 * DISPLAY_FFT * s2)
})()

/** Mean-square-equivalent level of the bins in [loHz, hiHz) of an average power spectrum (Nyquist included at the top), dBFS. */
function regionDb(power: Float64Array, count: number, sampleRate: number, loHz: number, hiHz: number): number {
  if (count === 0) return FLOOR_DB
  const half = DISPLAY_FFT / 2
  const top = hiHz >= sampleRate / 2
  let s = 0
  for (let k = 0; k <= half; k++) {
    const hz = (k * sampleRate) / DISPLAY_FFT
    if (hz < loHz || (!top && hz >= hiHz)) continue
    s += (k === 0 || k === half ? 1 : 2) * power[k]
  }
  return powDb(s * PARSEVAL)
}

/**
 * Where the person is not talking in the RAW take: the quiet lead the recording asks for (the first QUIET_SEC
 * seconds, whatever sounds in them: that is the point) and the pauses between words after it (the tuner's mask,
 * prepareTake: pause frames, kept clear of the words by a small guard). Merged, ascending, each at least 0.2 s.
 * Empty when the take cannot be measured.
 */
export function noiseStretches(take: Float32Array, sampleRate = 48000): Stretch[] {
  if (!(sampleRate > 0)) return []
  const n = take.length
  const lead = Math.round(QUIET_SEC * sampleRate)
  if (n < lead) return []
  const mask = maskOf(take, sampleRate)
  if (!mask) return []
  // pause frames (prepareTake): within PAUSE_MARGIN_DB of the room, PAUSE_GUARD frames (100 ms) or more from speech
  const runs: Stretch[] = [{ from: 0, to: lead }]
  for (const f of mask.pause) runs.push({ from: f * mask.win, to: (f + 1) * mask.win })
  const min = Math.round(MIN_STRETCH_SEC * sampleRate)
  return cleaned(runs, n).filter((s) => s.to - s.from >= min)
}

/**
 * Voice and noise of `audio` (the raw take itself, or a render of it: same length, aligned) with the stretches of
 * the RAW take: noise = the stretches, voice = the mask's speech windows of `take` (prepared once per take, cached).
 * Null when the take cannot be measured or there are no stretches.
 */
export function voiceNoiseOf(audio: Float32Array, take: Float32Array, stretches: readonly Stretch[], sampleRate = 48000): VoiceNoise | null {
  if (!(sampleRate > 0)) return null
  const mask = maskOf(take, sampleRate)
  if (!mask) return null
  const n = Math.min(audio.length, take.length)
  const noise = cleaned(stretches, n)
  if (!noise.length) return null

  const freqsHz = spectrumFreqs()
  const speechWindows = cleaned(mask.windows.map((st) => ({ from: st, to: st + FFT_N })), n)
  const noisePow = averagePower(audio, noise)
  const voicePow = averagePower(audio, without(speechWindows, noise))
  const voice = voicePow.power
  for (let k = 0; k < voice.length; k++) voice[k] = Math.max(voice[k] - noisePow.power[k], voice[k] * VOICE_FLOOR_SHARE)

  const speechFrames = cleaned(mask.speech.map((f) => ({ from: f * mask.win, to: (f + 1) * mask.win })), n)
  const voiceLevelDb = levelDb(audio, speechFrames)
  const region = (id: NoiseRegionId, loHz: number, hiHz: number): NoiseRegion => {
    const noiseDb = regionDb(noisePow.power, noisePow.count, sampleRate, loHz, hiHz)
    return { id, loHz, hiHz, noiseDb, underVoiceDb: voiceLevelDb - noiseDb }
  }
  return {
    freqsHz,
    voiceDb: plotDb(voice, voicePow.count, freqsHz, sampleRate),
    noiseDb: plotDb(noisePow.power, noisePow.count, freqsHz, sampleRate),
    voiceLevelDb,
    noiseLevelDb: levelDb(audio, noise),
    regions: [region('low', 0, LOW_MID_HZ), region('mid', LOW_MID_HZ, MID_HIGH_HZ), region('high', MID_HIGH_HZ, sampleRate / 2)],
  }
}

/**
 * Only the stretches of `audio`, one after the other (10 ms fades at each joint so nothing clicks): what "Noise
 * only" plays. Empty array when there are no stretches.
 */
export function noiseOnly(audio: Float32Array, stretches: readonly Stretch[], sampleRate = 48000): Float32Array {
  const spans = cleaned(stretches, audio.length)
  let total = 0
  for (const s of spans) total += s.to - s.from
  const out = new Float32Array(total)
  const fade = Math.max(1, Math.round(NOISE_FADE_SEC * (sampleRate > 0 ? sampleRate : 48000)))
  let at = 0
  for (const s of spans) {
    const len = s.to - s.from
    for (let i = 0; i < len; i++) out[at + i] = audio[s.from + i] * Math.min(1, i / fade, (len - 1 - i) / fade)
    at += len
  }
  return out
}
