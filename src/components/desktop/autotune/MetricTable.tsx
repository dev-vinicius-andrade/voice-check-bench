import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import type { Direction, MetricRow } from '../../../desktop/autotune/results'
import { bandKey, rowValue } from './format'

const COLOR: Record<Direction, string> = { better: 'success.main', worse: 'error.main', same: 'text.secondary' }

/** Before → after of the whole recording: level, peak, room noise, SNR, steadiness and the tone bands that moved. */
export function MetricTable({ rows }: { rows: readonly MetricRow[] }) {
  const { t } = useTranslation()
  const label = (r: MetricRow): string =>
    r.id === 'band'
      ? t('desktop.autotune.ui.result.metrics.band', { band: t(`desktop.autotune.ui.result.bands.${bandKey(r.band ?? 4)}`) })
      : t(`desktop.autotune.ui.result.metrics.${r.id}`)
  return (
    <section className="grid gap-2" aria-labelledby="autotune-metrics-title">
      <Typography id="autotune-metrics-title" variant="subtitle1" component="h3">{t('desktop.autotune.ui.result.metrics.title')}</Typography>
      <ul className="m-0 grid list-none gap-2 p-0" aria-label={t('desktop.autotune.ui.result.metrics.label')}>
        {rows.map((r) => (
          <li key={r.id === 'band' ? `band-${r.band}` : r.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5" data-testid={`autotune-metric-${r.id === 'band' ? `band-${r.band}` : r.id}`}>
            <Typography variant="body2" className="min-w-0 flex-1">{label(r)}</Typography>
            <span className="flex flex-wrap items-baseline gap-x-3">
              <Typography variant="body2" component="span" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {rowValue(r, r.before)} → {rowValue(r, r.after)}
              </Typography>
              <Typography variant="body2" component="span" color={COLOR[r.dir]} sx={{ fontWeight: 600 }}>
                {t(`desktop.autotune.ui.result.metrics.${r.dir}`)}
              </Typography>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
