import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Advice } from '../../../desktop/advice/types'
import { EffectCard } from './EffectCard'
import type { ChainState } from './useChainState'

/** "Your effects, in Wave Link order": collapsed cards, except the ones a "Try this" row points at. */
export function EffectsList({ chain, advice }: { chain: ChainState; advice: readonly Advice[] }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState<Record<number, boolean>>({})
  const model = chain.model
  const pointed = new Set(advice.map((a) => a.slot))
  return (
    <Paper component="section" className="grid gap-3 p-4" aria-labelledby="tune-effects-title" data-testid="tune-effects">
      <Typography id="tune-effects-title" variant="h6" component="h2">{t('desktop.tune.effects.title')}</Typography>
      {!model ? (
        <Typography variant="body2" color="text.secondary">{t('desktop.tune.effects.empty')}</Typography>
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0">
          {model.undo.chain.map((s) => (
            <EffectCard
              key={s.index}
              slot={s}
              engine={model.slots.find((x) => x.index === s.index)}
              vendor={model.entries?.find((e) => e.index === s.index)?.vendor ?? ''}
              expanded={open[s.index] ?? pointed.has(s.index)}
              onExpand={(o) => setOpen((m) => ({ ...m, [s.index]: o }))}
              onPreview={(key, v) => chain.preview(s.index, key, v)}
              onCommit={(key, v) => chain.commit(s.index, key, v)}
              onSwitch={(on) => chain.setOn(s.index, on)}
            />
          ))}
        </ul>
      )}
    </Paper>
  )
}
