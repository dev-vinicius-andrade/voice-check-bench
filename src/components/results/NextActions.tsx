import { useState } from 'react'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Collapse from '@mui/material/Collapse'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import type { ActionContext } from '../../plain/actions'
import type { Action } from '../../plain/types'
import { MsgText } from '../common/MsgText'
import { GainHow, PlacementHow } from './HowPanels'

interface NextActionsProps {
  actions: readonly Action[]
  ctx: ActionContext
  /** Opens the technical details and scrolls to the suggested settings. */
  onShowSettings: () => void
}

function ActionItem({ n, x, ctx, onShowSettings }: { n: number; x: Action; ctx: ActionContext; onShowSettings: () => void }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const panelId = `how-${x.id}`
  const onHow = (): void => (x.how === 'settings' ? onShowSettings() : setOpen((o) => !o))
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3">
      <Typography
        component="span"
        aria-hidden="true"
        className="grid h-7 w-7 place-items-center rounded-full"
        sx={{ bgcolor: 'primary.main', color: 'primary.contrastText', fontWeight: 700, fontSize: 14 }}
      >
        {n}
      </Typography>
      <div className="grid min-w-0 gap-1.5">
        <Typography sx={{ fontWeight: 600 }}><MsgText msg={x.text} /></Typography>
        <div className="flex flex-wrap items-center gap-2">
          <Chip size="small" variant="outlined" color={x.cost === 'free' ? 'success' : 'default'} label={t(`results.next.cost.${x.cost}`)} />
          {x.how && (
            <Button
              size="small"
              variant="text"
              onClick={onHow}
              aria-expanded={x.how === 'settings' ? undefined : open}
              aria-controls={x.how === 'settings' ? 'suggested-settings' : panelId}
            >
              {open ? t('results.next.hideHow') : t('results.next.showHow')}
            </Button>
          )}
        </div>
        {x.how && x.how !== 'settings' && (
          <Collapse in={open} id={panelId}>
            {x.how === 'gain' ? <GainHow /> : <PlacementHow mic={ctx.mic} bestDist={ctx.bestDist} />}
          </Collapse>
        )}
      </div>
    </li>
  )
}

/** "What to do next": up to 3 actions, biggest impact first, each with a cost and a "Show me how". */
export function NextActions({ actions, ctx, onShowSettings }: NextActionsProps) {
  const { t } = useTranslation()
  return (
    <Paper component="section" aria-labelledby="next-actions-title" className="grid gap-3 p-4">
      <Typography id="next-actions-title" variant="h6" component="h2">{t('results.next.title')}</Typography>
      {actions.length ? (
        <ol className="m-0 grid list-none gap-4 p-0" data-testid="next-actions">
          {actions.map((x, i) => (
            <ActionItem key={x.id} n={i + 1} x={x} ctx={ctx} onShowSettings={onShowSettings} />
          ))}
        </ol>
      ) : (
        <Typography color="text.secondary">{t('results.next.none')}</Typography>
      )}
    </Paper>
  )
}
