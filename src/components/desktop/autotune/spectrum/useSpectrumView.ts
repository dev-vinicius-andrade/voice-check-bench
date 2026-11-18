import { useMemo, useState } from 'react'
import type { SpectrumAnalyzer, SpectrumTone } from '../../../../desktop/spectrum'
import type { VoiceNoise } from '../../../../desktop/spectrum/voiceNoise'
import type { AbSide } from '../useAbPlayer'
import type { TakeVoiceNoise } from '../useVoiceNoise'

/** What the result step's spectrum shows: the whole recording (before / after) or the voice and the noise apart. */
export type SpectrumView = 'whole' | 'voiceNoise'

/**
 * The plot's analyzer for "Voice and noise": the voice as the filled curve (processedDb), the noise as the thin line
 * (rawDb), the take's steady tones. A still picture: it does not follow the player.
 */
export function voiceNoiseAnalyzer(v: VoiceNoise, tones: readonly SpectrumTone[]): SpectrumAnalyzer {
  const spectrum = { freqsHz: v.freqsHz, rawDb: v.noiseDb, processedDb: v.voiceDb, tones }
  return { push: () => undefined, reset: () => undefined, read: () => spectrum }
}

/**
 * The spectrum card's view: "Whole recording" (the take analyzer) or "Voice and noise" of the side the player's
 * Before / After is on. Only offered when the take has noise stretches; otherwise always the whole recording.
 */
export function useSpectrumView(vn: TakeVoiceNoise, side: AbSide, whole: SpectrumAnalyzer, tones: readonly SpectrumTone[]) {
  const [picked, setView] = useState<SpectrumView>('whole')
  const available = vn.before !== null && vn.after !== null
  const shown = side === 'before' ? vn.before : vn.after
  const split = useMemo(() => (shown ? voiceNoiseAnalyzer(shown, tones) : null), [shown, tones])
  const view: SpectrumView = available && picked === 'voiceNoise' && split ? 'voiceNoise' : 'whole'
  return { available, view, setView, analyzer: view === 'voiceNoise' && split ? split : whole }
}
