// The live screen's spectrum (SPEC "Live spectrum"): the plot's smoothed spectrum of the mic alone and as heard, and
// the steady tones found in either. All FFT work happens in push(); read() hands back the same arrays. Framework-free.
import type { AudioFrame } from '../types'
import { DisplaySpectrum, spectrumFreqs } from './display'
import { TONE_FFT, ToneTracker, type ToneFound } from './tones'
import { MAX_TONES, type LiveSpectrum, type SpectrumAnalyzer, type SpectrumTone } from './types'

/**
 * Two tones closer than this are one (the raw and processed sightings of a tone, or two peaks of one tone's lobe):
 * the larger of MERGE_SHARE of the frequency and MERGE_BINS long-FFT bins. Not the 3 % first planned: the whistles
 * measured come in pairs only 2.6 % apart (899 / 923 Hz, 768 / 788 Hz), which are two tones.
 */
export const MERGE_SHARE = 0.01
export const MERGE_BINS = 3

interface Side {
  display: DisplaySpectrum
  tones: ToneTracker
}

export function createSpectrumAnalyzer(): SpectrumAnalyzer {
  const freqsHz = spectrumFreqs()
  let sampleRate = 0
  let raw: Side | null = null
  let processed: Side | null = null
  const empty = new Float32Array(freqsHz.length).fill(-200)
  const out: LiveSpectrum = { freqsHz, rawDb: empty, processedDb: empty, tones: [] }

  const side = (sr: number): Side => ({ display: new DisplaySpectrum(freqsHz, sr), tones: new ToneTracker(sr) })

  const reset = (): void => {
    raw?.display.reset()
    raw?.tones.reset()
    processed?.display.reset()
    processed?.tones.reset()
    out.tones = []
  }

  const updateTones = (r: Side, p: Side): void => {
    const binHz = r.tones.sampleRate / TONE_FFT
    const near = (a: number, b: number): boolean => Math.abs(a - b) <= Math.max(MERGE_SHARE * Math.max(a, b), MERGE_BINS * binHz)
    const all: (ToneFound & { raw: boolean })[] = [...r.tones.tones().map((t) => ({ ...t, raw: true })), ...p.tones.tones().map((t) => ({ ...t, raw: false }))].sort((a, b) => b.overDb - a.overDb)
    const merged: (SpectrumTone & { processedLevel: number | null })[] = []
    for (const t of all) {
      const hit = merged.find((m) => near(m.freqHz, t.freqHz))
      if (hit) {
        if (t.raw) hit.inRaw = true
        else {
          hit.inProcessed = true
          hit.processedLevel ??= t.levelDb
        }
        continue
      }
      merged.push({ freqHz: t.freqHz, levelDb: 0, overDb: t.overDb, inRaw: t.raw, inProcessed: !t.raw, processedLevel: t.raw ? null : t.levelDb })
    }
    out.tones = merged.slice(0, MAX_TONES).map(({ processedLevel, ...t }) => ({ ...t, levelDb: processedLevel ?? p.tones.levelAt(t.freqHz) }))
  }

  return {
    push(frame: AudioFrame): void {
      const sr = frame.sampleRate
      if (!(sr > 0)) return
      if (sr !== sampleRate || !raw || !processed) {
        sampleRate = sr
        raw = side(sr)
        processed = side(sr)
        out.rawDb = raw.display.db
        out.processedDb = processed.display.db
        out.tones = []
      } else if (frame.latencyChanged) reset()
      const n = Math.min(frame.raw.length, frame.processed.length)
      const before = raw.tones.analysed
      raw.display.push(frame.raw, n)
      processed.display.push(frame.processed, n)
      raw.tones.push(frame.raw, n)
      processed.tones.push(frame.processed, n)
      if (raw.tones.analysed !== before) updateTones(raw, processed)
    },
    read: () => out,
    reset,
  }
}
