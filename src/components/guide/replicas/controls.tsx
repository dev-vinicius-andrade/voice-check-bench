// Inert look-alike controls for the plugin replicas (no inputs: the frame is aria-hidden and inert).
import Box from '@mui/material/Box'
import type { ReactNode } from 'react'
import { highlightRing, RC } from './replicaStyle'
import { Spot } from './Spot'

interface Common {
  target?: string
  highlight?: boolean
}

const box = { border: `1px solid ${RC.line}`, borderRadius: '4px', bgcolor: RC.panel, px: 0.75, height: 22, display: 'inline-flex', alignItems: 'center' } as const

export function Check({ label, checked, target, highlight }: Common & { label: ReactNode; checked: boolean }) {
  return (
    <Spot target={target}>
      <Box component="span" data-checked={checked} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, ...(highlight ? highlightRing : {}) }}>
        <Box component="span" sx={{ width: 13, height: 13, border: `1px solid ${checked ? RC.primary : RC.muted}`, borderRadius: '3px', bgcolor: checked ? RC.primary : 'transparent', display: 'inline-flex', flex: 'none' }}>
          {checked && (
            <svg viewBox="0 0 12 12" width={11} height={11}>
              <path d="M2.5 6.2 5 8.6 9.6 3.4" fill="none" stroke={RC.onPrimary} strokeWidth={1.8} />
            </svg>
          )}
        </Box>
        <span>{label}</span>
      </Box>
    </Spot>
  )
}

export function Select({ value, width = 120, target, highlight }: Common & { value: string; width?: number }) {
  return (
    <Spot target={target}>
      <Box component="span" data-value={value} sx={{ ...box, width, justifyContent: 'space-between', ...(highlight ? { ...highlightRing, bgcolor: RC.tint } : {}) }}>
        <span>{value}</span>
        <Box component="span" sx={{ color: RC.muted, ml: 1 }}>▾</Box>
      </Box>
    </Spot>
  )
}

export function Btn({ label, target }: { label: string; target?: string }) {
  return (
    <Spot target={target}>
      <Box component="span" sx={{ ...box, px: 1.25 }}>{label}</Box>
    </Spot>
  )
}

/** Value field showing the exact text to type (empty when the step does not change it). */
export function Field({ value = '', width = 64, target, highlight }: Common & { value?: string; width?: number }) {
  return (
    <Spot target={target}>
      <Box component="span" data-field sx={{ ...box, width, justifyContent: 'flex-end', bgcolor: RC.surface, fontWeight: 700, ...(highlight ? highlightRing : {}) }}>
        {value}
      </Box>
    </Spot>
  )
}

/** Horizontal slider track with the thumb at `pos` (0..1). */
export function HSlider({ pos, width = 220 }: { pos: number; width?: number }) {
  return (
    <Box component="span" sx={{ position: 'relative', display: 'inline-block', width, height: 14, flex: 'none' }}>
      <Box component="span" sx={{ position: 'absolute', left: 0, right: 0, top: 6, height: 3, borderRadius: 2, bgcolor: RC.line }} />
      <Box component="span" sx={{ position: 'absolute', left: 0, width: `${pos * 100}%`, top: 6, height: 3, borderRadius: 2, bgcolor: RC.primary }} />
      <Box component="span" sx={{ position: 'absolute', left: `calc(${pos * 100}% - 5px)`, top: 2, width: 10, height: 11, borderRadius: '2px', bgcolor: RC.ink }} />
    </Box>
  )
}

/** Vertical slider with the thumb at `pos` (0 = bottom, 1 = top). */
export function VSlider({ pos, height = 150 }: { pos: number; height?: number }) {
  return (
    <Box component="span" sx={{ position: 'relative', display: 'inline-block', width: 16, height, flex: 'none' }}>
      <Box component="span" sx={{ position: 'absolute', top: 0, bottom: 0, left: 6, width: 4, borderRadius: 2, bgcolor: RC.line }} />
      <Box component="span" sx={{ position: 'absolute', bottom: 0, height: `${pos * 100}%`, left: 6, width: 4, borderRadius: 2, bgcolor: RC.primary }} />
      <Box component="span" sx={{ position: 'absolute', bottom: `calc(${pos * 100}% - 5px)`, left: 1, width: 14, height: 10, borderRadius: '2px', bgcolor: RC.ink }} />
    </Box>
  )
}

/** On/off switch (Wave Link style). */
export function Toggle({ on, target }: { on: boolean; target?: string }) {
  return (
    <Spot target={target}>
      <Box component="span" data-on={on} sx={{ width: 30, height: 16, borderRadius: 8, bgcolor: on ? RC.primary : RC.line, position: 'relative', display: 'inline-block' }}>
        <Box component="span" sx={{ position: 'absolute', top: 2, left: on ? 16 : 2, width: 12, height: 12, borderRadius: '50%', bgcolor: on ? RC.onPrimary : RC.muted }} />
      </Box>
    </Spot>
  )
}

/** Small group box with a caption, like the plugins' framed sections. */
export function Group({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <Box sx={{ border: `1px solid ${RC.line}`, borderRadius: '4px', p: 1, pt: 1.25, position: 'relative' }}>
      {label && <Box component="span" sx={{ position: 'absolute', top: -9, left: 8, px: 0.5, bgcolor: RC.surface, color: RC.muted }}>{label}</Box>}
      {children}
    </Box>
  )
}
