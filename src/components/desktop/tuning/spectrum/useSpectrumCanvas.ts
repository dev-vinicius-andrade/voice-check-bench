import { useTheme } from '@mui/material/styles'
import { useEffect, useRef, type RefObject } from 'react'
import type { SpectrumAnalyzer } from '../../../../desktop/spectrum'
import { GRID_HZ, plotBox, SPEC_GRID_DB, xOfHz, yOfDbfs, type PlotBox } from './plotScale'

/** At most this many redraws per second. */
const FPS = 15

export interface Colors {
  grid: string
  heard: string
  raw: string
}

/** Theme colours as the page shows them now (the CSS variables follow light / dark), the theme's values as a fallback. */
function colorsOf(el: Element, fallback: Colors): Colors {
  const css = getComputedStyle(el)
  const v = (name: string, alt: string): string => css.getPropertyValue(name).trim() || alt
  return {
    grid: v('--mui-palette-divider', fallback.grid),
    heard: v('--mui-palette-primary-main', fallback.heard),
    raw: v('--mui-palette-text-secondary', fallback.raw),
  }
}

/** The curve through the points; `join` continues the current subpath (a lineTo to the first point, not a moveTo). */
function line(ctx: CanvasRenderingContext2D, b: PlotBox, freqs: Float32Array, db: Float32Array, join = false): void {
  for (let i = 0; i < freqs.length; i++) {
    const x = xOfHz(b, freqs[i])
    const y = yOfDbfs(b, db[i])
    if (i === 0 && !join) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
}

/** One frame: the grid, the area under "as heard" (closed along the plot's bottom), its line, the mic alone's line. */
export function drawSpectrum(ctx: CanvasRenderingContext2D, b: PlotBox, analyzer: SpectrumAnalyzer, c: Colors): void {
  const { freqsHz, rawDb, processedDb } = analyzer.read()
  ctx.lineWidth = 1
  ctx.strokeStyle = c.grid
  ctx.beginPath()
  for (const hz of GRID_HZ) {
    const x = Math.round(xOfHz(b, hz)) + 0.5
    ctx.moveTo(x, b.top)
    ctx.lineTo(x, b.top + b.height)
  }
  for (const db of SPEC_GRID_DB) {
    const y = Math.round(yOfDbfs(b, db)) + 0.5
    ctx.moveTo(b.left, y)
    ctx.lineTo(b.left + b.width, y)
  }
  ctx.stroke()
  if (freqsHz.length === 0) return
  const bottom = b.top + b.height
  // as heard: a faint area with a line on top; one subpath bottom-left → curve → bottom-right, closed along the bottom
  ctx.beginPath()
  ctx.moveTo(xOfHz(b, freqsHz[0]), bottom)
  line(ctx, b, freqsHz, processedDb, true)
  ctx.lineTo(xOfHz(b, freqsHz[freqsHz.length - 1]), bottom)
  ctx.closePath()
  ctx.globalAlpha = 0.18
  ctx.fillStyle = c.heard
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.beginPath()
  line(ctx, b, freqsHz, processedDb)
  ctx.lineWidth = 1.5
  ctx.strokeStyle = c.heard
  ctx.stroke()
  // the mic alone: a thin line
  ctx.beginPath()
  line(ctx, b, freqsHz, rawDb)
  ctx.lineWidth = 1
  ctx.strokeStyle = c.raw
  ctx.stroke()
}

/**
 * Draws the grid and the two spectra on the canvas from requestAnimationFrame, at most FPS times a second, reading
 * analyzer.read() each time (no React state per frame). Sized for the device pixel ratio. Returns the canvas ref.
 */
export function useSpectrumCanvas(analyzer: SpectrumAnalyzer, w: number, h: number): RefObject<HTMLCanvasElement | null> {
  const canvas = useRef<HTMLCanvasElement>(null)
  const theme = useTheme()
  const fallback: Colors = { grid: theme.palette.divider, heard: theme.palette.primary.main, raw: theme.palette.text.secondary }
  const { grid, heard, raw } = fallback
  useEffect(() => {
    const el = canvas.current
    const ctx = el?.getContext('2d')
    if (!el || !ctx || w <= 0 || h <= 0) return
    const dpr = window.devicePixelRatio || 1
    el.width = Math.round(w * dpr)
    el.height = Math.round(h * dpr)
    const b = plotBox(w, h)
    let raf = 0
    let last = -Infinity
    const loop = (now: number): void => {
      raf = requestAnimationFrame(loop)
      if (now - last < 1000 / FPS) return
      last = now
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      drawSpectrum(ctx, b, analyzer, colorsOf(el, { grid, heard, raw }))
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [analyzer, w, h, grid, heard, raw])
  return canvas
}
