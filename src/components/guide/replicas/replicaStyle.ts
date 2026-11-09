// Theme CSS variables used by the plugin replicas. The frame sets class "dark" so these resolve to the dark scheme inside it.
export const RC = {
  surface: 'var(--mui-palette-background-default)',
  panel: 'var(--mui-palette-background-paper)',
  line: 'var(--mui-palette-divider)',
  ink: 'var(--mui-palette-text-primary)',
  muted: 'var(--mui-palette-text-secondary)',
  primary: 'var(--mui-palette-primary-main)',
  onPrimary: 'var(--mui-palette-primary-contrastText)',
  tint: 'rgba(var(--mui-palette-primary-mainChannel) / 0.16)',
} as const

/** Visually hidden but read by screen readers. */
export const srOnly = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const

/** Primary outline used to emphasise the control a step is about. */
export const highlightRing = { outline: `2px solid ${RC.primary}`, outlineOffset: 1 } as const
