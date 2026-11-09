// Take analysis ported 1:1 from the prototype analyze() (docs/prototype/voice-check.html). Pure.
import type { AnalysisResult, HumPeak } from '../types'
import { adb, db, median, pct, powerSpec } from './dsp'
import { BANDS, QUIET_SEC } from './reference'

/** dB above the noise floor that a 50 ms frame needs to count as speech, tried in order. */
export const SPEECH_MARGINS = [15, 10, 6] as const

export const NOT_ENOUGH_SPEECH =
  'Not enough speech detected. Speak louder or closer, or check the selected input.'

/**
 * Analyze a mono take: the first QUIET_SEC seconds are room silence, then speech.
 * 50 ms frames, robust noise estimate, speech mask, per-second spread, 8192-pt long-term
 * spectra, hum peaks in the silence window, 2048-pt sibilance per speech frame.
 */
export function analyze(x: Float32Array, sampleRate: number): AnalysisResult {
  const sr = sampleRate
  const win = Math.round(0.05 * sr)
  const nF = Math.floor(x.length / win)
  const fr = new Float64Array(nF)

  let peak = 0
  let clip = 0
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i])
    if (a > peak) peak = a
    if (a >= 0.999) clip++
  }
  for (let f = 0; f < nF; f++) {
    let s = 0
    for (let i = f * win; i < (f + 1) * win; i++) s += x[i] * x[i]
    fr[f] = adb(Math.sqrt(s / win))
  }

  const qa = Math.round(0.6 / 0.05)
  const qb = Math.round((QUIET_SEC - 0.3) / 0.05)
  const sStart = Math.round(QUIET_SEC / 0.05)
  const quiet: number[] = []
  for (let f = qa; f < Math.min(qb, nF); f++) quiet.push(fr[f])

  // noise: median of the silence window, but never trust it if the quietest 10% of the whole take is clearly lower
  const globalNoise = pct(fr, 0.1)
  const noiseFromQuiet = quiet.length >= 10
  let noise = noiseFromQuiet ? median(quiet) : globalNoise
  let quietLoud = false
  if (noiseFromQuiet && noise > globalNoise + 6) {
    noise = globalNoise
    quietLoud = true
  }

  // Speech = frames clearly above the noise. Start with the prototype's 15 dB margin; on a noisy input
  // (loud room, hum, low SNR) fall back to 10 then 6 dB so the take is still analyzed and the noise
  // check reports the problem instead of the whole take being rejected.
  let sp: number[] = []
  let spIdx: number[] = []
  for (const margin of SPEECH_MARGINS) {
    sp = []
    spIdx = []
    for (let f = noiseFromQuiet ? sStart : 0; f < nF; f++) {
      if (fr[f] > noise + margin && fr[f] > -70) {
        sp.push(fr[f])
        spIdx.push(f)
      }
    }
    if (sp.length >= 20) break
  }
  if (sp.length < 20) return { error: NOT_ENOUGH_SPEECH }

  // talking in the quiet window?
  const quietMax = quiet.length ? Math.max(...quiet) : -200
  // sound in the silence window: a loud spike, or a window that is mostly speech (very uneven levels)
  const quietBroken = noiseFromQuiet && (quietLoud || quietMax > Math.max(noise + 30, -60))

  // per-second loudness spread: only seconds with real voiced speech (ignore breaths, trailing seconds)
  const voiced = median(sp) - 12
  const perSec: number[] = []
  const fps = 20
  for (let s = sStart; s < nF; s += fps) {
    let m = -200
    let c = 0
    for (let f = s; f < Math.min(s + fps, nF); f++) {
      if (fr[f] > voiced) {
        c++
        if (fr[f] > m) m = fr[f]
      }
    }
    if (c >= 4) perSec.push(m)
  }

  // long-term spectra
  const N = 8192
  const hop = 4096
  const specS = new Float64Array(N / 2 + 1)
  const specN = new Float64Array(N / 2 + 1)
  let cN = 0
  const isSp = new Uint8Array(nF)
  for (const f of spIdx) isSp[f] = 1
  for (let st = 0; st + N <= x.length; st += hop) {
    let sCount = 0
    for (let f = Math.floor(st / win); f < Math.floor((st + N) / win) && f < nF; f++) sCount += isSp[f]
    const frames = N / win
    if (sCount >= frames * 0.6) {
      const p = powerSpec(x, st, N)
      for (let i = 0; i < p.length; i++) specS[i] += p[i]
    } else if (st / sr >= 0.5 && (st + N) / sr <= QUIET_SEC - 0.2) {
      const p = powerSpec(x, st, N)
      for (let i = 0; i < p.length; i++) specN[i] += p[i]
      cN++
    }
  }
  const binHz = sr / N
  const bandE = (spec: Float64Array): number[] =>
    BANDS.map((b) => {
      let s = 0
      for (let i = Math.ceil(b.lo / binHz); i < b.hi / binHz && i < spec.length; i++) s += spec[i]
      return db(s)
    })
  const eS = bandE(specS)
  const ref = eS[4]
  const rel = eS.map((e) => e - ref)

  // hum (neighbour bins outside the spectrum read as undefined and sort last, exactly as in the prototype)
  const hum: HumPeak[] = []
  if (cN > 0) {
    for (const h of [50, 60, 100, 120, 150, 180]) {
      const i = Math.round(h / binHz)
      const nb: number[] = []
      for (let k = i - 20; k <= i + 20; k++) if (Math.abs(k - i) > 2) nb.push(specN[k])
      const pk = Math.max(specN[i - 1], specN[i], specN[i + 1])
      hum.push({ hz: h, db: db(pk) - db(median(nb)) })
    }
  }

  // sibilance per frame
  const sN = 2048
  const sib: number[] = []
  const lo = Math.round((5000 * sN) / sr)
  const hi = Math.round((9000 * sN) / sr)
  for (const f of spIdx) {
    const p = powerSpec(x, f * win, sN)
    let t = 0
    let s = 0
    for (let i = 1; i < p.length; i++) {
      t += p[i]
      if (i >= lo && i < hi) s += p[i]
    }
    sib.push(db(s / t))
  }

  const speechMed = median(sp)
  return {
    sampleRate: sr,
    duration: x.length / sr,
    peak: adb(peak),
    clip,
    noise,
    noiseFromQuiet,
    quietBroken,
    speechMed,
    speechP90: pct(sp, 0.9),
    speechMax: Math.max(...sp),
    snr: speechMed - noise,
    spread: perSec.length > 2 ? pct(perSec, 0.9) - pct(perSec, 0.1) : 0,
    rel,
    hum,
    sibMed: median(sib),
    sibP95: pct(sib, 0.95),
  }
}
