import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { fmtSigned } from '../../i18n/format'
import type { LiveMetrics } from '../../live/types'
import { LivePanel } from './LivePanel'
import { tonePct, toneColor } from './liveScale'

/** BANDS indices shown: boom … air (rumble is left out). */
const ROWS = [1, 2, 3, 4, 5, 6, 7, 8] as const
/** Seconds of speech in the window before the tone means something. */
const MIN_TALK_SEC = 1

const DOT = { position: 'absolute', top: '50%', width: 12, height: 12, ml: '-6px', mt: '-6px', borderRadius: '50%' } as const

function ToneRow({ band, raw, fx }: { band: number; raw: number | null; fx: number }) {
  const { t } = useTranslation()
  const name = t(`results.band.${band}`)
  const fxOk = Number.isFinite(fx)
  const rawOk = raw !== null && Number.isFinite(raw)
  const label = rawOk
    ? t('live.tone.rowRaw', { band: name, raw: fmtSigned(raw), fx: fmtSigned(fx) })
    : t('live.tone.row', { band: name, fx: fmtSigned(fx) })
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)_3rem] items-center gap-2" role="listitem" aria-label={label} data-testid={`live-tone-${band}`}>
      <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }} aria-hidden>{name}</Typography>
      <Box sx={{ position: 'relative', height: 18 }} aria-hidden>
        <Box sx={{ position: 'absolute', left: 0, right: 0, top: '50%', height: 2, mt: '-1px', bgcolor: 'divider' }} />
        <Box sx={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 2, ml: '-1px', bgcolor: 'text.secondary' }} />
        {rawOk && <Box sx={{ ...DOT, left: `${tonePct(raw)}%`, border: 2, borderColor: 'text.secondary', bgcolor: 'background.paper' }} />}
        {fxOk && <Box sx={{ ...DOT, left: `${tonePct(fx)}%`, bgcolor: `${toneColor(fx)}.main` }} />}
      </Box>
      <Typography variant="body2" align="right" sx={{ fontVariantNumeric: 'tabular-nums' }} color={fxOk ? `${toneColor(fx)}.main` : 'text.secondary'} aria-hidden>
        {fmtSigned(fx)}
      </Typography>
    </div>
  )
}

/** One row per band: goal at the centre, hollow dot raw, filled dot Wave Link, ±12 dB. Dimmed until 1 s of speech. */
export function ToneCard({ metrics }: { metrics: LiveMetrics }) {
  const { t } = useTranslation()
  const waiting = metrics.talkSec < MIN_TALK_SEC
  return (
    <LivePanel title={t('live.tone.title')} lead={t('live.tone.lead')} testId="live-tone" dim={waiting}>
      {waiting && (
        <Typography variant="body2" sx={{ fontWeight: 600 }} data-testid="live-tone-wait">{t('live.tone.keepTalking')}</Typography>
      )}
      <div role="list" className="grid gap-1.5">
        {ROWS.map((b) => (
          <ToneRow key={b} band={b} raw={metrics.raw ? (metrics.raw.tone[b] ?? NaN) : null} fx={metrics.fx.tone[b] ?? NaN} />
        ))}
      </div>
    </LivePanel>
  )
}
