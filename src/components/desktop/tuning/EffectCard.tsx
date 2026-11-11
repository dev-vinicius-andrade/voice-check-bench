import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import Button from '@mui/material/Button'
import Collapse from '@mui/material/Collapse'
import FormControlLabel from '@mui/material/FormControlLabel'
import IconButton from '@mui/material/IconButton'
import Paper from '@mui/material/Paper'
import Switch from '@mui/material/Switch'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import type { ChainSlot } from '../../../desktop/advice/types'
import { slidersOf } from '../../../desktop/sliderSpecs'
import type { AudioSlot } from '../../../desktop/types'
import { SlotSliders } from './SlotSliders'
import { useSlotSummary } from './useSlotSummary'

interface EffectCardProps {
  slot: ChainSlot
  engine: AudioSlot | undefined
  vendor: string
  expanded: boolean
  onExpand: (open: boolean) => void
  onPreview: (key: string, v: number) => void
  onCommit: (key: string, v: number) => void
  onSwitch: (on: boolean) => void
}

/** One effect: name, vendor, On switch, plugin window, a one-line summary; the sliders when opened. Built-ins greyed out. */
export function EffectCard({ slot, engine, vendor, expanded, onExpand, onPreview, onCommit, onSwitch }: EffectCardProps) {
  const { t } = useTranslation()
  const hosted = engine?.status.status === 'hosted'
  const summary = useSlotSummary(slot)
  const sliders = hosted ? slidersOf(slot) : []
  const reason = engine?.status.status === 'loadFailed' ? 'loadFailed' : 'builtin'
  return (
    <Paper variant="outlined" component="li" className="grid gap-2 p-3" data-testid={`tune-effect-${slot.index}`} sx={{ opacity: hosted ? 1 : 0.55 }}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="grid min-w-0 flex-1">
          <Typography sx={{ fontWeight: 700 }} component="h3">{slot.name}</Typography>
          <Typography variant="caption" color="text.secondary" noWrap>
            {[vendor, hosted ? summary : t(`desktop.tune.effects.${reason}`)].filter(Boolean).join(' · ')}
          </Typography>
        </div>
        {hosted && (
          <>
            <FormControlLabel
              control={<Switch size="small" checked={slot.on} onChange={(e) => onSwitch(e.target.checked)} />}
              label={t('desktop.tune.effects.on')}
            />
            <Tooltip title={t('desktop.tune.effects.comingSoon')}>
              <span>
                <Button size="small" variant="outlined" disabled>{t('desktop.tune.effects.pluginWindow')}</Button>
              </span>
            </Tooltip>
            {sliders.length > 0 && (
              <IconButton
                size="small"
                aria-expanded={expanded}
                aria-label={t(expanded ? 'desktop.tune.effects.hide' : 'desktop.tune.effects.show', { plugin: slot.name })}
                onClick={() => onExpand(!expanded)}
              >
                <ExpandMoreIcon sx={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
              </IconButton>
            )}
          </>
        )}
      </div>
      {hosted && slot.kind === 'reafir' && (
        <Typography variant="body2" color="text.secondary">{t('desktop.tune.effects.reafirNote')}</Typography>
      )}
      {sliders.length > 0 && (
        <Collapse in={expanded} unmountOnExit>
          <SlotSliders slot={slot} sliders={sliders} onPreview={onPreview} onCommit={onCommit} />
        </Collapse>
      )}
    </Paper>
  )
}
