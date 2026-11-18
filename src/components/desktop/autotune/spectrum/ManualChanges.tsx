import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { manualLines } from '../../../../desktop/autotune/manualEq'
import { useMsg } from '../../../common/MsgText'
import type { ManualEq } from '../useManualEq'

/** "Your changes": one line per value set by hand (chain order), and one "Undo my changes" for all of them. */
export function ManualChanges({ manual }: { manual: Pick<ManualEq, 'tuned' | 'edits' | 'clear'> }) {
  const { t } = useTranslation()
  const tm = useMsg()
  const { tuned, edits } = manual
  const lines = useMemo(() => (tuned && edits.length ? manualLines(tuned, edits) : []), [tuned, edits])
  if (!edits.length) return null
  return (
    <div className="grid gap-1" data-testid="take-spectrum-mine">
      <Typography variant="subtitle2" component="h4">{t('desktop.autotune.ui.spectrum.mine.title')}</Typography>
      <ul className="m-0 grid list-none gap-1 p-0">
        {lines.map((l) => (
          <li key={l.id}>
            <Typography variant="body2">{tm(l.msg)}</Typography>
          </li>
        ))}
      </ul>
      <div>
        <Button size="small" variant="outlined" onClick={manual.clear}>{t('desktop.autotune.ui.spectrum.mine.undo')}</Button>
      </div>
    </div>
  )
}
