import { useEffect, useMemo, useRef, useState } from 'react'
import { createTakeAnalyzer } from '../../../../desktop/spectrum/take'
import { eqPointsOf, notchPlan } from '../../../../desktop/spectrum'
import type { ToneListRow } from '../../tuning/spectrum/ToneList'
import { plotBox, plotFreqs } from '../../tuning/spectrum/plotScale'
import { useBoxSize } from '../../tuning/spectrum/useBoxSize'
import { useEqDrag } from '../../tuning/spectrum/useEqDrag'
import { sameTone } from '../../tuning/spectrum/useToneCuts'
import type { AbSide } from '../useAbPlayer'
import type { ManualEq, TakeCut } from '../useManualEq'

/** Until the plot has been measured. */
const FALLBACK_SIZE = { w: 800, h: 260 }
/** A drag only moves what the plot shows: the take is rendered once the handle is let go. */
const noPreview = (): void => undefined

/** Where the player is: the plot follows it while it plays (or stands paused somewhere); "Voice and noise" its side. */
export interface PlayerAt {
  position: number
  playing: boolean
  side: AbSide
}

/**
 * Everything the result step's spectrum shows and does: the take and its render analysed (following the player),
 * the first switched-on ReaEQ of the chain with the hand edits, its handles (a release is a hand edit) and tone cuts.
 */
export function useTakeSpectrum(take: Float32Array, processed: Float32Array, manual: ManualEq, player: PlayerAt) {
  const analyzer = useMemo(() => createTakeAnalyzer(take, processed), [take, processed])
  // the steady tones of the whole take (read() may reuse its arrays)
  const tones = useMemo(() => analyzer.read().tones.map((t) => ({ ...t })), [analyzer])
  const { position, playing } = player
  useEffect(() => {
    analyzer.seek(playing || position > 0 ? position : null)
  }, [analyzer, playing, position])

  const svg = useRef<SVGSVGElement>(null)
  const [frame, size] = useBoxSize<HTMLDivElement>(FALLBACK_SIZE)
  const box = useMemo(() => plotBox(size.w, size.h), [size.w, size.h])
  const [freqs] = useState(plotFreqs)
  const [selected, setSelected] = useState<number | null>(null)

  const slot = manual.chain?.find((s) => s.kind === 'reaeq' && s.on) ?? null
  // a slot keeps its identity until one of its values is edited (manualChain)
  const points = useMemo(() => (slot ? eqPointsOf(slot) : []), [slot])
  const target = slot ? { slot: slot.index, preview: noPreview, commit: manual.set } : null
  const drag = useEqDrag(target, points, box, svg, setSelected)

  const cuts = manual.cuts.filter((c) => c.slot === slot?.index)
  const rows: ToneListRow<TakeCut>[] = tones.map((tone) => ({ tone, cut: cuts.find((c) => sameTone(c.tone.freqHz, tone.freqHz)) ?? null, plan: slot ? notchPlan(points, tone) : null }))
  for (const c of cuts) if (!rows.some((r) => r.cut === c)) rows.push({ tone: c.tone, cut: c, plan: null })
  const cut = (row: ToneListRow<TakeCut>): void => {
    const plan = slot && notchPlan(points, row.tone)
    if (!slot || !plan) return
    manual.cut(slot, plan, row.tone)
    setSelected(plan.n)
  }

  return { analyzer, tones, frame, svg, size, box, freqs, slot, bands: slot ? drag.shown : null, selected, drag, rows, cut }
}
