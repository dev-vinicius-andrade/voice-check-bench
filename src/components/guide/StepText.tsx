import type { ReactNode } from 'react'
import Typography from '@mui/material/Typography'
import type { StepAction } from './guideFormat'

interface StepTextProps {
  lead?: ReactNode
  actions: readonly StepAction[]
  /** Extra lines under the numbered actions (tips, alternatives). */
  notes?: ReactNode
}

/** Plain lead sentence + numbered actions (numbers match the replica's callouts) + optional notes. */
export function StepText({ lead, actions, notes }: StepTextProps) {
  return (
    <div className="grid gap-2">
      {lead && <Typography color="text.secondary">{lead}</Typography>}
      {actions.length > 0 && (
        <ol className="m-0 grid list-none gap-1.5 p-0">
          {actions.map((a, i) => (
            <li key={i} className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2">
              <Typography
                component="span"
                aria-hidden="true"
                className="grid h-6 w-6 place-items-center rounded-full"
                sx={{ bgcolor: 'primary.main', color: 'primary.contrastText', fontWeight: 700, fontSize: 13 }}
              >
                {i + 1}
              </Typography>
              <Typography sx={{ overflowWrap: 'anywhere' }}>{a.text}</Typography>
            </li>
          ))}
        </ol>
      )}
      {notes}
    </div>
  )
}

/** A secondary line under the actions. */
export function StepNote({ children }: { children: ReactNode }) {
  return (
    <Typography variant="body2" color="text.secondary">
      {children}
    </Typography>
  )
}
