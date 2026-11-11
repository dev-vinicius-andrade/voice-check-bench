import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { fmtDb, fmtDbfs, fmtNum, fmtSigned } from '../../../i18n/format'
import { isHeld, type HeldMetrics } from '../../../live/hold'
import { useMsg } from '../../common/MsgText'
import { levelCard, pausesCard, toneCard, type CardView } from './cardStatus'

function MetricCard({ title, big, caption, view, testId }: { title: string; big: string; caption: string; view: CardView; testId: string }) {
  const tm = useMsg()
  const color = view.status ? `${view.status}.main` : 'text.secondary'
  return (
    <Paper component="section" aria-label={title} className="grid min-w-0 content-start gap-1 p-4" data-testid={testId} sx={{ borderTop: 4, borderColor: color }}>
      <Typography variant="subtitle2" color="text.secondary" component="h3">{title}</Typography>
      <Typography sx={{ fontSize: { xs: 28, sm: 34 }, fontWeight: 800, lineHeight: 1.15 }} data-testid={`${testId}-value`}>{big}</Typography>
      <Typography variant="body2" color="text.secondary">{caption}</Typography>
      <Typography variant="body2" sx={{ fontWeight: 600, color }} data-testid={`${testId}-problem`}>{tm(view.problem)}</Typography>
    </Paper>
  )
}

/** Voice level, Pauses, Tone vs your goal: processed big, mic alone in the caption, the problem in its status colour. */
export function MetricCards({ metrics }: { metrics: HeldMetrics }) {
  const { t } = useTranslation()
  const level = levelCard(metrics)
  const pauses = pausesCard(metrics)
  const tone = toneCard(metrics)
  const band = tone.band === null ? '' : t(`results.band.${tone.band}`)
  const ago = metrics.fx.heardAgoMs
  return (
    <div className="grid gap-2">
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard
          title={t('desktop.tune.cards.level.title')}
          big={fmtDbfs(level.value)}
          caption={t('desktop.tune.cards.micAlone', { v: fmtDbfs(level.raw) })}
          view={level}
          testId="tune-level"
        />
        <MetricCard
          title={t('desktop.tune.cards.pauses.title')}
          big={fmtDb(pauses.value, 0, false)}
          caption={t('desktop.tune.cards.micAlone', { v: fmtDb(pauses.raw, 0, false) })}
          view={pauses}
          testId="tune-pauses"
        />
        <MetricCard
          title={t('desktop.tune.cards.tone.title')}
          big={tone.band === null ? fmtSigned(NaN) : `${band} ${fmtDb(tone.value)}`}
          caption={t('desktop.tune.cards.micAlone', { v: fmtDb(tone.raw) })}
          view={{ ...tone, problem: { ...tone.problem, params: { band } } }}
          testId="tune-tone"
        />
      </div>
      {isHeld({ heardAgoMs: ago }) && (
        <Typography variant="caption" color="text.secondary" data-testid="tune-held">
          {t('live.held', { sec: fmtNum((ago ?? 0) / 1000, 0) })}
        </Typography>
      )}
    </div>
  )
}
