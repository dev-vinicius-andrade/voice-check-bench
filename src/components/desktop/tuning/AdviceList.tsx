import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import type { Advice } from '../../../desktop/advice/types'
import type { Msg } from '../../../plain/types'
import { useMsg } from '../../common/MsgText'
import type { AppliedRow } from './useChainState'

function Row({ advice, action, onClick }: { advice: Advice; action: 'apply' | 'undo'; onClick: () => void }) {
  const { t } = useTranslation()
  const tm = useMsg()
  return (
    <li className="flex flex-wrap items-center gap-3 py-2" data-testid={`tune-advice-${action}`}>
      <div className="grid min-w-0 flex-1 gap-0.5">
        <Typography variant="body2">{tm(advice.titleMsg)}</Typography>
        <Typography variant="body2" sx={{ fontWeight: 700 }}>{tm(advice.changeMsg)}</Typography>
      </div>
      <Button size="small" variant={action === 'apply' ? 'contained' : 'outlined'} onClick={onClick}>
        {t(action === 'apply' ? 'desktop.tune.try.apply' : 'desktop.tune.try.undo')}
      </Button>
    </li>
  )
}

interface AdviceListProps {
  advice: readonly Advice[]
  applied: readonly AppliedRow[]
  notice: Msg | null
  onApply: (a: Advice) => void
  onUndo: (appliedId: string) => void
  onCloseNotice: () => void
}

/** "Try this": one row per advice with Apply; applied changes stay with their own Undo. */
export function AdviceList({ advice, applied, notice, onApply, onUndo, onCloseNotice }: AdviceListProps) {
  const { t } = useTranslation()
  const tm = useMsg()
  const empty = advice.length === 0 && applied.length === 0
  return (
    <Paper component="section" className="grid gap-2 p-4" aria-labelledby="tune-try-title" data-testid="tune-try">
      <Typography id="tune-try-title" variant="h6" component="h2">{t('desktop.tune.try.title')}</Typography>
      {notice && (
        <Alert severity="info" onClose={onCloseNotice} data-testid="tune-notice">{tm(notice)}</Alert>
      )}
      {empty ? (
        <Typography variant="body2" color="text.secondary">{t('desktop.tune.try.empty')}</Typography>
      ) : (
        <ul className="m-0 grid list-none gap-1 p-0">
          {applied.map((a) => (
            <Row key={a.appliedId} advice={a.advice} action="undo" onClick={() => onUndo(a.appliedId)} />
          ))}
          {advice.map((a) => (
            <Row key={a.id} advice={a} action="apply" onClick={() => onApply(a)} />
          ))}
        </ul>
      )}
    </Paper>
  )
}
