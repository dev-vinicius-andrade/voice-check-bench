import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { FLOOR_DB } from '../../../audio/analyze'
import type { CalSummary } from '../../../desktop/calibrate/types'
import { cutsSpeech } from '../../../desktop/tune/score'
import { fmtDbfs, fmtNum } from '../../../i18n/format'
import { useMsg } from '../../common/MsgText'

interface CalibrateResultProps {
  summary: CalSummary
  canMore: boolean
  canLess: boolean
  onMore: () => void
  onLess: () => void
  onUndo: () => void
}

/** The result: the room, the pauses before → after, the words, what changed; More / Less reduction, Undo calibration. */
export function CalibrateResult({ summary: s, canMore, canLess, onMore, onLess, onUndo }: CalibrateResultProps) {
  const { t } = useTranslation()
  const tm = useMsg()
  const cut = cutsSpeech(s)
  const level = (db: number): string => (db <= FLOOR_DB ? t('desktop.tune.calibrate.result.silence') : fmtDbfs(db))
  return (
    <div className="grid gap-2" data-testid="tune-calibrate-result">
      {Number.isFinite(s.roomDb) && (
        <>
          <Typography variant="body2">{t('desktop.tune.calibrate.result.room', { level: fmtDbfs(s.roomDb) })}</Typography>
          <Typography variant="body2" sx={{ fontWeight: 700 }} data-testid="tune-calibrate-pauses">
            {t('desktop.tune.calibrate.result.pauses', { before: level(s.beforeDb), after: level(s.afterDb) })}
          </Typography>
        </>
      )}
      {Number.isFinite(s.cutShare) && (
        <Typography variant="body2" color={cut ? 'warning.main' : 'success.main'}>
          {cut ? t('desktop.tune.calibrate.result.cut', { pct: fmtNum(s.cutShare * 100, 1) }) : t('desktop.tune.calibrate.result.wordsWhole')}
        </Typography>
      )}
      {s.changes.length > 0 ? (
        <div className="grid gap-0.5">
          <Typography variant="subtitle2" component="h3">{t('desktop.tune.calibrate.result.changes')}</Typography>
          <ul className="m-0 grid list-none gap-0.5 p-0">
            {s.changes.map((c, i) => (
              <Typography key={i} component="li" variant="body2">{tm(c)}</Typography>
            ))}
          </ul>
        </div>
      ) : (
        <Typography variant="body2" color="text.secondary">{t('desktop.tune.calibrate.result.noChanges')}</Typography>
      )}
      {s.notes.map((n, i) => (
        <Typography key={i} variant="body2" color="text.secondary">{tm(n)}</Typography>
      ))}
      <div className="flex flex-wrap justify-end gap-2">
        {s.changes.length > 0 && <Button onClick={onUndo}>{t('desktop.tune.calibrate.undo')}</Button>}
        <Button variant="outlined" disabled={!canLess} onClick={onLess}>{t('desktop.tune.calibrate.less')}</Button>
        <Button variant="outlined" disabled={!canMore} onClick={onMore}>{t('desktop.tune.calibrate.more')}</Button>
      </div>
    </div>
  )
}
