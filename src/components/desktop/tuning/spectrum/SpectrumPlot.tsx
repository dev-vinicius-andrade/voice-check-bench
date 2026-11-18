import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import type { EqPoint, SpectrumAnalyzer, SpectrumTone } from '../../../../desktop/spectrum'
import { fmtDbfs, fmtHz } from '../../../../i18n/format'
import { BandHandles } from './BandHandles'
import { PlotAxes } from './PlotAxes'
import { EqCurve, ToneMarkers } from './PlotLayers'
import { hzOfX, nearestIndex, type PlotBox } from './plotScale'
import type { EqDrag } from './useEqDrag'
import { useSpectrumCanvas } from './useSpectrumCanvas'

/** Below this level nothing was heard there yet (the analyzer's −200). */
const SILENT_DB = -150

interface SpectrumPlotProps {
  /** Callback ref of the plot's frame (its size is measured). */
  frame: (el: HTMLDivElement | null) => void
  svg: RefObject<SVGSVGElement | null>
  size: { w: number; h: number }
  box: PlotBox
  freqs: Float32Array
  analyzer: SpectrumAnalyzer
  tones: readonly SpectrumTone[]
  /** The ReaEQ bands as shown (null: no ReaEQ on, no curve and no handles). */
  bands: readonly EqPoint[] | null
  selected: number | null
  drag: EqDrag
  /** i18n keys of the plot's label and hover readout ({{hz}}, {{level}}); the live screen's by default. */
  ariaKey?: string
  readoutKey?: string
}

/**
 * The plot: grid and spectra on a canvas (useSpectrumCanvas), then in SVG the axis labels, the EQ curve, the
 * steady-tone markers and the band handles; the hover readout (frequency, level as heard) in the corner.
 */
export function SpectrumPlot({ frame, svg, size, box, freqs, analyzer, tones, bands, selected, drag, ariaKey = 'desktop.tune.spectrum.aria', readoutKey = 'desktop.tune.spectrum.readout' }: SpectrumPlotProps) {
  const { t } = useTranslation()
  const [hoverHz, setHoverHz] = useState<number | null>(null)
  const canvas = useSpectrumCanvas(analyzer, size.w, size.h)

  // the wheel over a handle changes its width; a native listener, so the page does not scroll meanwhile
  const wheel = useRef(drag.wheel)
  useEffect(() => {
    wheel.current = drag.wheel
  })
  useEffect(() => {
    const el = svg.current
    if (!el) return
    const on = (e: WheelEvent): void => {
      const band = e.target instanceof Element ? e.target.closest('[data-band]') : null
      if (!band) return
      e.preventDefault()
      wheel.current(Number(band.getAttribute('data-band')), e.deltaY)
    }
    el.addEventListener('wheel', on, { passive: false })
    return () => el.removeEventListener('wheel', on)
  }, [svg])

  const level = hoverHz === null ? null : analyzer.read().processedDb[nearestIndex(freqs, hoverHz)]
  return (
    <Box ref={frame} className="relative w-full" sx={{ height: { xs: 200, sm: 260 } }} data-testid="spectrum-plot">
      <canvas ref={canvas} aria-hidden="true" className="absolute inset-0 block h-full w-full" />
      <svg
        ref={svg}
        role="group"
        aria-label={t(ariaKey)}
        className="absolute inset-0 block h-full w-full overflow-visible"
        style={{ fontFamily: 'inherit' }}
        onPointerMove={(e) => {
          const x = e.clientX - e.currentTarget.getBoundingClientRect().left
          setHoverHz(x >= box.left && x <= box.left + box.width ? hzOfX(box, x) : null)
        }}
        onPointerLeave={() => setHoverHz(null)}
      >
        <PlotAxes box={box} eq={bands !== null} />
        {bands && <EqCurve box={box} freqs={freqs} points={bands} />}
        <ToneMarkers box={box} tones={tones} />
        {bands && <BandHandles box={box} bands={bands} selected={selected} drag={drag} />}
      </svg>
      {hoverHz !== null && (
        <Typography
          variant="caption"
          color="text.secondary"
          data-testid="spectrum-readout"
          className="pointer-events-none absolute"
          sx={{ top: box.top + 2, right: size.w - box.left - box.width + 6, fontVariantNumeric: 'tabular-nums' }}
        >
          {level !== null && level !== undefined && level > SILENT_DB
            ? t(readoutKey, { hz: fmtHz(hoverHz), level: fmtDbfs(level, 1) })
            : fmtHz(hoverHz)}
        </Typography>
      )}
    </Box>
  )
}
