import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { useId } from 'react'

/** Titled card used by every live panel. */
export function LivePanel({ title, lead, children, testId, dim }: { title: string; lead?: string; children: React.ReactNode; testId?: string; dim?: boolean }) {
  const id = useId()
  return (
    <Paper
      component="section"
      aria-labelledby={id}
      className="grid min-w-0 content-start gap-3 p-4"
      data-testid={testId}
      sx={{ opacity: dim ? 0.55 : 1, transition: 'opacity .25s' }}
    >
      <div className="grid gap-1">
        <Typography id={id} variant="h6" component="h2">{title}</Typography>
        {lead && <Typography variant="body2" color="text.secondary">{lead}</Typography>}
      </div>
      {children}
    </Paper>
  )
}
