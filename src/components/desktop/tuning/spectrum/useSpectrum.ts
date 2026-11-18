import { useEffect, useRef, useState } from 'react'
import { createSpectrumAnalyzer, type SpectrumAnalyzer, type SpectrumTone } from '../../../../desktop/spectrum'
import type { LiveEngine } from '../useLiveEngine'

/** Seconds of stream heard before "no steady tone" can be said. */
export const LISTEN_SEC = 4

export interface LiveSpectrumFeed {
  /** The analyzer of the stream (the plot reads it on its own clock). */
  analyzer: SpectrumAnalyzer
  /** Steady tones found so far (a new array only when what the list shows changed). */
  tones: readonly SpectrumTone[]
  /** Less than LISTEN_SEC heard since the engine started. */
  listening: boolean
}

/** What the tone list shows of a tone: whole hertz and whole dB. */
const sigOf = (tones: readonly SpectrumTone[]): string => tones.map((t) => `${Math.round(t.freqHz)}:${Math.round(t.overDb)}`).join('|')

/**
 * The spectrum analyzer on the live engine's frames (`onFrame`). Starts over when the engine starts or stops; React
 * state changes only when the tone list or the listening state would show something different.
 */
export function useSpectrum(engine: Pick<LiveEngine, 'state' | 'onFrame'>): LiveSpectrumFeed {
  const [analyzer] = useState(createSpectrumAnalyzer)
  const [tones, setTones] = useState<readonly SpectrumTone[]>([])
  const [listening, setListening] = useState(true)
  const running = engine.state === 'running'
  const [wasRunning, setWasRunning] = useState(running)
  const heardSec = useRef(0)
  const sig = useRef('')

  // the engine started or stopped: nothing heard yet (state adjusted while rendering, the analyzer in the effect)
  if (wasRunning !== running) {
    setWasRunning(running)
    setTones([])
    setListening(true)
  }
  useEffect(() => {
    analyzer.reset()
    heardSec.current = 0
    sig.current = ''
  }, [analyzer, running])

  const { onFrame } = engine
  useEffect(
    () =>
      onFrame((f) => {
        analyzer.push(f)
        heardSec.current += f.processed.length / (f.sampleRate || 48000)
        if (heardSec.current >= LISTEN_SEC) setListening(false)
        const now = analyzer.read().tones
        const s = sigOf(now)
        if (s === sig.current) return
        sig.current = s
        setTones(now.map((t) => ({ ...t })))
      }),
    [onFrame, analyzer],
  )

  return { analyzer, tones, listening }
}
