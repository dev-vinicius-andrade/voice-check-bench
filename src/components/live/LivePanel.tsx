import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { fmtNum } from '../../i18n/format'
import { isHeld } from '../../live/hold'

interface LivePanelProps {
  title: string
  lead?: string
  /** How long ago the speech values shown were measured (HeldSide.heardAgoMs): "Last heard N s ago" while held. */
  heardAgoMs?: number | null
  children: React.ReactNode
  testId?: string
  dim?: boolean
}

/** Titled card used by every live panel. */
export function LivePanel({ title, lead, heardAgoMs = null, children, testId, dim }: LivePanelProps) {
  const id = useId()
  const { t } = useTranslation()
  const caption = isHeld({ heardAgoMs }) ? t('live.held', { sec: fmtNum((heardAgoMs ?? 0) / 1000, 0) }) : null
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
        {caption && (
          <Typography variant="caption" color="text.secondary" data-testid={testId ? `${testId}-held` : undefined}>{caption}</Typography>
        )}
        {lead && <Typography variant="body2" color="text.secondary">{lead}</Typography>}
      </div>
      {children}
    </Paper>
  )
}
