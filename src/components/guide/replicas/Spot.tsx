import Box from '@mui/material/Box'
import type { ReactNode } from 'react'
import { monoFont } from '../../../theme'
import { useCalloutNumber } from './calloutContext'
import { RC } from './replicaStyle'

const SIZE = 22

/** Numbered circular callout marker (primary, 22 px, mono number). */
export function CalloutMark({ n }: { n: number }) {
  return (
    <Box
      component="span"
      data-callout={n}
      sx={{
        width: SIZE,
        height: SIZE,
        borderRadius: '50%',
        bgcolor: RC.primary,
        color: RC.onPrimary,
        fontFamily: monoFont,
        fontSize: 12,
        fontWeight: 700,
        lineHeight: `${SIZE}px`,
        textAlign: 'center',
        display: 'inline-block',
        flex: 'none',
      }}
    >
      {n}
    </Box>
  )
}

/** Wraps a control; when a callout targets it, a marker sits on its top-left corner without shifting the layout. */
export function Spot({ target, children, block = false }: { target?: string; children: ReactNode; block?: boolean }) {
  const n = useCalloutNumber(target)
  return (
    <Box component="span" data-target={target} sx={{ position: 'relative', display: block ? 'block' : 'inline-flex', alignItems: 'center' }}>
      {children}
      {n !== undefined && (
        <Box component="span" sx={{ position: 'absolute', top: -SIZE / 2 - 2, left: -SIZE / 2 - 2, zIndex: 1, lineHeight: 0 }}>
          <CalloutMark n={n} />
        </Box>
      )}
    </Box>
  )
}
