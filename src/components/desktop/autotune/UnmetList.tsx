import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Msg } from '../../../plain/types'
import { useMsg } from '../../common/MsgText'

/** Shown before "Show all". */
export const UNMET_SHOWN = 4

/**
 * "What it could not do": the tuner's unmet goals, the first few, then all on request. They were measured on the
 * tuner's own result: with hand edits (`edited`) a caption says so.
 */
export function UnmetList({ unmet, edited = false }: { unmet: readonly Msg[]; edited?: boolean }) {
  const { t } = useTranslation()
  const tm = useMsg()
  const [all, setAll] = useState(false)
  if (!unmet.length) return null
  const shown = all ? unmet : unmet.slice(0, UNMET_SHOWN)
  return (
    <Alert severity="warning" data-testid="autotune-unmet">
      {edited && (
        <Typography variant="caption" component="p" className="m-0" data-testid="autotune-unmet-before-edits">
          {t('desktop.autotune.ui.spectrum.measuredBefore')}
        </Typography>
      )}
      <Typography variant="subtitle2" component="h3">{t('desktop.autotune.ui.result.unmet')}</Typography>
      <ul className="m-0 grid gap-1 pl-5">
        {shown.map((m, i) => (
          <Typography component="li" variant="body2" key={`${m.key}-${i}`}>{tm(m)}</Typography>
        ))}
      </ul>
      {unmet.length > UNMET_SHOWN && (
        <Button size="small" color="inherit" onClick={() => setAll(!all)}>
          {all ? t('desktop.autotune.ui.result.showFewer') : t('desktop.autotune.ui.result.showAll', { count: unmet.length })}
        </Button>
      )}
    </Alert>
  )
}
