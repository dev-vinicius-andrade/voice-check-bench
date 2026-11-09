import { useMemo } from 'react'
import Chip from '@mui/material/Chip'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { deviations } from '../../audio/reference'
import { useCommunityMic } from '../../community/useCommunity'
import type { CommunityMicStats } from '../../community/types'
import { bestControl, sessionSlots } from '../../session/bestControl'
import { useBench } from '../../store/benchStore'
import { useMicProfile } from '../../store/hooks'
import { isAnalysisError, type Analysis, type Take } from '../../types'
import { CommunityDeviationChart } from './CommunityDeviationChart'
import { fmtHz } from './roomNoise'

const RAW_STEPS = new Set(['c2', 'c8', 'c15'])
const TOP_EQ = 5

/** The session's best raw control take, else A when A itself is a raw control. */
function yourRawAnalysis(takes: readonly Take[], A: Take): Analysis | null {
  const best = A.session === 'free' ? null : bestControl(sessionSlots(takes, A.session))?.take
  const t = best ?? (A.step && RAW_STEPS.has(A.step) ? A : null)
  return t && !isAnalysisError(t.analysis) ? t.analysis : null
}

const signed = (v: number): string => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}`

function Stats({ m, mine }: { m: CommunityMicStats; mine: Analysis | null }) {
  const top = m.bestDistance[0]
  const s = m.rawSnr
  return (
    <div className="grid gap-1" style={{ fontVariantNumeric: 'tabular-nums' }}>
      <Typography variant="body2">
        Raw SNR: {mine && Number.isFinite(mine.snr) && <>yours <b>{mine.snr.toFixed(0)}</b> dB · </>}
        typical <b>{s.median.toFixed(0)}</b> dB ({s.p25.toFixed(0)}–{s.p75.toFixed(0)})
      </Typography>
      {top && (
        <Typography variant="body2">
          Best distance: most voted <b>{top.dist}</b> ({top.votes} of {m.reports})
        </Typography>
      )}
    </div>
  )
}

/** "People with this mic": your best raw control vs the community stats for the same model. */
export function CommunityMicCard({ A }: { A: Take }) {
  const { model } = useMicProfile()
  const m = useCommunityMic(model)
  const takes = useBench((s) => s.takes)
  const mine = useMemo(() => yourRawAnalysis(takes, A), [takes, A])
  if (!model.trim()) return null
  if (!m) {
    return (
      <Typography variant="body2" color="text.secondary">
        No community data for {model.trim()} yet — be the first to share.
      </Typography>
    )
  }
  const eq = m.eq.slice(0, TOP_EQ)
  return (
    <Paper component="section" aria-label="People with this mic" className="grid gap-2 px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <Typography sx={{ fontWeight: 700 }}>People with this mic</Typography>
        <Typography variant="caption" color="text.secondary">
          {m.reports} {m.reports === 1 ? 'report' : 'reports'}
        </Typography>
      </div>
      <Stats m={m} mine={mine} />
      {m.deviations.length > 0 && (
        <CommunityDeviationChart yours={mine ? deviations(mine.rel) : null} community={m.deviations} />
      )}
      {eq.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Typography variant="caption" color="text.secondary">Typical EQ they used:</Typography>
          {eq.map((e) => (
            <Chip key={`${e.type}-${e.freq}`} size="small" label={`${e.type} ${fmtHz(e.freq)} ${signed(e.gainMedian)} dB`} />
          ))}
        </div>
      )}
    </Paper>
  )
}
