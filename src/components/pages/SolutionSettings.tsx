import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import type { CommunitySolution } from '../../community/types'
import { fmtDb, fmtHz, fmtNum } from '../../i18n/format'

/** Whole numbers without decimals ("3:1", "−48 dB"), others with one. */
const digits = (v: number): number => (Number.isInteger(v) ? 0 : 1)

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="contents">
      <Typography component="dt" variant="body2" color="text.secondary">{term}</Typography>
      <Typography component="dd" variant="body2" sx={{ m: 0, fontVariantNumeric: 'tabular-nums' }}>{children}</Typography>
    </div>
  )
}

/** Compact summary of shared settings: EQ bands, compressor, gate, noise removal. */
export function SolutionSettings({ s }: { s: CommunitySolution['suggestion'] }) {
  const { t } = useTranslation()
  return (
    <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1" data-testid="solution-settings">
      <Row term={t('pages.community.solutions.settings.eq')}>
        {s.eq.length ? (
          <span className="grid">
            {s.eq.map((b, i) => (
              <span key={`${b.type}-${b.freq}-${i}`}>{`${b.type} ${fmtHz(b.freq)} ${fmtDb(b.gain, digits(b.gain))}`}</span>
            ))}
          </span>
        ) : (
          t('pages.community.solutions.settings.eqNone')
        )}
      </Row>
      <Row term={t('pages.community.solutions.settings.comp')}>
        {t('pages.community.solutions.settings.compValue', { threshold: fmtDb(s.comp.threshold, digits(s.comp.threshold), false), ratio: fmtNum(s.comp.ratio, digits(s.comp.ratio)) })}
      </Row>
      <Row term={t('pages.community.solutions.settings.gate')}>{t('pages.community.solutions.settings.gateValue', { threshold: fmtDb(s.gate.threshold, digits(s.gate.threshold), false) })}</Row>
      <Row term={t('pages.community.solutions.settings.noise')}>{t(s.noiseReduction ? 'pages.community.solutions.settings.on' : 'pages.community.solutions.settings.off')}</Row>
    </dl>
  )
}
