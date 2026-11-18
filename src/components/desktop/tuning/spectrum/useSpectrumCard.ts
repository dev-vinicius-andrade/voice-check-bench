import { useMemo, useRef, useState } from 'react'
import type { ChainSlot } from '../../../../desktop/advice/types'
import { eqPointsOf } from '../../../../desktop/spectrum'
import type { ChainModel, ChainState } from '../useChainState'
import type { LiveEngine } from '../useLiveEngine'
import { plotBox, plotFreqs } from './plotScale'
import { useBoxSize } from './useBoxSize'
import { useEqDrag } from './useEqDrag'
import { useSpectrum } from './useSpectrum'
import { useToneCuts } from './useToneCuts'

/** Until the plot has been measured. */
const FALLBACK_SIZE = { w: 800, h: 260 }

/** The first ReaEQ of the live chain that is switched on and hosted by the engine (the one the plot shapes). */
export function eqSlotOf(model: ChainModel | null): ChainSlot | null {
  if (!model) return null
  const hosted = (s: ChainSlot): boolean => model.slots.find((x) => x.index === s.index)?.status.status === 'hosted'
  return model.undo.chain.find((s) => s.kind === 'reaeq' && s.on && hosted(s)) ?? null
}

/** Everything the "Live spectrum" card shows and does: the analyzer feed, the ReaEQ bands and their handles, tone cuts. */
export function useSpectrumCard(engine: Pick<LiveEngine, 'state' | 'onFrame'>, chain: ChainState) {
  const feed = useSpectrum(engine)
  const svg = useRef<SVGSVGElement>(null)
  const [frame, size] = useBoxSize<HTMLDivElement>(FALLBACK_SIZE)
  const box = useMemo(() => plotBox(size.w, size.h), [size.w, size.h])
  const [freqs] = useState(plotFreqs)
  const [selected, setSelected] = useState<number | null>(null)

  const slot = eqSlotOf(chain.model)
  // a slot keeps its identity until one of its values changes (withChange)
  const points = useMemo(() => (slot ? eqPointsOf(slot) : []), [slot])
  const { preview, commit } = chain
  const target = slot ? { slot: slot.index, preview, commit } : null
  const drag = useEqDrag(target, points, box, svg, setSelected)
  const cuts = useToneCuts(chain, slot, points, feed.tones, setSelected)

  return {
    running: engine.state === 'running',
    feed,
    frame,
    svg,
    size,
    box,
    freqs,
    slot,
    bands: slot ? drag.shown : null,
    selected,
    drag,
    cuts,
  }
}
