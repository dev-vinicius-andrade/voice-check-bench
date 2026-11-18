import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toggleBother } from '../../../desktop/autotune/goals'
import type { Bother } from '../../../desktop/tune'
import { BotherGroups } from './BotherGroups'
import { Choice } from './ChipGroup'

/** "Not right, adjust": Too processed, or what still bothers the person (one or the other) → tune again. */
export function AdjustPanel({ onRetune, onCancel }: { onRetune: (f: readonly Bother[] | 'tooProcessed') => void; onCancel: () => void }) {
  const { t } = useTranslation()
  const [pick, setPick] = useState<Bother[] | 'tooProcessed'>([])
  const list = pick === 'tooProcessed' ? [] : pick
  const ready = pick === 'tooProcessed' || pick.length > 0
  return (
    <Paper variant="outlined" component="section" className="grid gap-3 p-3" data-testid="autotune-adjust">
      <BotherGroups
        title={t('desktop.autotune.ui.result.adjustTitle')}
        isOn={(b) => list.includes(b)}
        onToggle={(b) => setPick(toggleBother(list, b))}
        extra={{ processing: <Choice label={t('desktop.autotune.ui.result.tooProcessed')} on={pick === 'tooProcessed'} onClick={() => setPick(pick === 'tooProcessed' ? [] : 'tooProcessed')} /> }}
      />
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onCancel}>{t('desktop.autotune.ui.result.cancelAdjust')}</Button>
        <Button variant="contained" disabled={!ready} onClick={() => onRetune(pick)}>{t('desktop.autotune.ui.result.retune')}</Button>
      </div>
    </Paper>
  )
}
