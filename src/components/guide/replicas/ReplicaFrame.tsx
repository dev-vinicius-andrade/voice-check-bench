import Box from '@mui/material/Box'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { monoFont } from '../../../theme'
import { CalloutContext } from './calloutContext'
import { RC, srOnly } from './replicaStyle'
import type { Callout } from './types'
import { useFitScale } from './useFitScale'

/** Room for callout markers that sit on the top-left corner of the first controls. */
const PAD = 12

interface Props {
  /** Window title, e.g. "ReaEQ (ReaPlugs Edition)" (never translated). */
  title: string
  /** Natural width in px; narrower containers scale the panel down. */
  width: number
  /** Screen-reader text: the values to set, one line each. */
  summary: string[]
  callouts?: Callout[]
  testId?: string
  children: ReactNode
}

/**
 * Window-like frame for a plugin replica. The drawn panel is decorative (aria-hidden, inert); its values are in the
 * visually hidden summary. Class "dark" switches the theme CSS variables to the dark scheme inside the frame.
 */
export function ReplicaFrame({ title, width, summary, callouts = [], testId, children }: Props) {
  const { t } = useTranslation()
  const [ref, scale] = useFitScale(width - PAD, PAD)
  return (
    <Box component="section" aria-label={title} data-testid={testId} sx={{ position: 'relative', maxWidth: width }}>
      <Box ref={ref} sx={{ overflowX: 'auto', overflowY: 'hidden', pt: `${PAD}px`, pl: `${PAD}px` }}>
        <Box
          className="dark"
          aria-hidden
          inert
          sx={{
            width: width - PAD,
            zoom: scale,
            colorScheme: 'dark',
            bgcolor: RC.surface,
            color: RC.ink,
            border: `1px solid ${RC.line}`,
            borderRadius: 1,
            fontFamily: monoFont,
            fontSize: 12,
            lineHeight: 1.4,
            userSelect: 'none',
            position: 'relative',
          }}
        >
          <Box sx={{ px: 1.5, py: 0.75, bgcolor: RC.panel, borderBottom: `1px solid ${RC.line}`, borderRadius: '8px 8px 0 0', fontWeight: 700, color: RC.ink }}>
            {title}
          </Box>
          <CalloutContext.Provider value={callouts}>
            <Box sx={{ p: 1.5 }}>{children}</Box>
          </CalloutContext.Provider>
        </Box>
      </Box>
      <Box sx={srOnly}>
        <p>{t('replicas.summaryTitle', { plugin: title })}</p>
        <ul>
          {summary.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Box>
    </Box>
  )
}
