import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import type { Msg } from '../../plain/types'
import { MsgText } from '../common/MsgText'
import { LivePanel } from './LivePanel'

/** "Try now": the engine's plain hints, most important first. */
export function HintsCard({ hints }: { hints: Msg[] }) {
  const { t } = useTranslation()
  return (
    <LivePanel title={t('live.hints.title')} testId="live-hints">
      {hints.length === 0 ? (
        <Typography variant="body2" color="text.secondary">{t('live.hints.empty')}</Typography>
      ) : (
        <ul className="m-0 grid gap-1 pl-5">
          {hints.map((m, i) => (
            <Typography component="li" variant="body2" key={`${m.key}-${i}`}>
              <MsgText msg={m} />
            </Typography>
          ))}
        </ul>
      )}
    </LivePanel>
  )
}
