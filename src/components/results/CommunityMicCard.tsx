import { useMemo } from 'react'
import Chip from '@mui/material/Chip'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { Trans, useTranslation } from 'react-i18next'
import { deviations } from '../../audio/reference'
import { useCommunityMic } from '../../community/useCommunity'
import type { CommunityMicStats } from '../../community/types'
import { fmtDb, fmtHz, fmtNum } from '../../i18n/format'
import { useBench } from '../../store/benchStore'
import { useMicProfile } from '../../store/hooks'
import type { Analysis, Take } from '../../types'
import { CommunityDeviationChart } from './CommunityDeviationChart'
import { yourRawAnalysis } from './roomNoise'

const TOP_EQ = 5
const b = <b />

function Stats({ m, mine }: { m: CommunityMicStats; mine: Analysis | null }) {
  const top = m.bestDistance[0]
  const s = m.rawSnr
  const snr = { median: fmtNum(s.median, 0), p25: fmtNum(s.p25, 0), p75: fmtNum(s.p75, 0) }
  return (
    <div className="grid gap-1" style={{ fontVariantNumeric: 'tabular-nums' }}>
      <Typography variant="body2">
        {mine && Number.isFinite(mine.snr) ? (
          <Trans i18nKey="results.community.rawSnrYours" values={{ ...snr, yours: fmtNum(mine.snr, 0) }} components={{ b }} />
        ) : (
          <Trans i18nKey="results.community.rawSnr" values={snr} components={{ b }} />
        )}
      </Typography>
      {top && (
        <Typography variant="body2">
          <Trans
            i18nKey="results.community.bestDistance"
            values={{ dist: top.dist, votes: fmtNum(top.votes, 0), reports: fmtNum(m.reports, 0) }}
            components={{ b }}
          />
        </Typography>
      )}
    </div>
  )
}

/** "People with this mic": your best raw control vs the community stats for the same model. */
export function CommunityMicCard({ A }: { A: Take }) {
  const { t } = useTranslation()
  const { model } = useMicProfile()
  const m = useCommunityMic(model)
  const takes = useBench((s) => s.takes)
  const mine = useMemo(() => yourRawAnalysis(takes, A), [takes, A])
  if (!model.trim()) return null
  if (!m) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t('results.community.none', { model: model.trim() })}
      </Typography>
    )
  }
  const eq = m.eq.slice(0, TOP_EQ)
  return (
    <Paper component="section" aria-label={t('results.community.title')} className="grid gap-2 px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <Typography sx={{ fontWeight: 700 }}>{t('results.community.title')}</Typography>
        <Typography variant="caption" color="text.secondary">
          {t('results.community.reports', { count: m.reports })}
        </Typography>
      </div>
      <Stats m={m} mine={mine} />
      {m.deviations.length > 0 && (
        <CommunityDeviationChart yours={mine ? deviations(mine.rel) : null} community={m.deviations} />
      )}
      {eq.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Typography variant="caption" color="text.secondary">{t('results.community.typicalEq')}</Typography>
          {eq.map((e) => (
            <Chip key={`${e.type}-${e.freq}`} size="small" label={`${e.type} ${fmtHz(e.freq)} ${fmtDb(e.gainMedian, 1)}`} />
          ))}
        </div>
      )}
    </Paper>
  )
}
