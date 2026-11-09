// One-line plain summaries of the before/after and community cards, shown outside the technical details.
// Both compare SNR only (voice over room noise), the number the clarity score's noise part uses.
import { useMemo } from 'react'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useCommunityMic } from '../../community/useCommunity'
import { fmtNum } from '../../i18n/format'
import { useBench } from '../../store/benchStore'
import { useMicProfile } from '../../store/hooks'
import type { Take } from '../../types'
import { beforeAfterPair, yourRawAnalysis } from './roomNoise'

/** SNR gains below this many dB count as "no real change" (same as the before/after card). */
const MIN_GAIN = 3
/** Every 10 dB sounds about half as loud: 8 dB and up reads as "half", 18 dB "a quarter", 25 dB "less than a quarter". */
const HALF_DB = 8
const QUARTER_DB = 18
const BELOW_QUARTER_DB = 25

function beforeAfterKey(gain: number): string {
  if (gain >= BELOW_QUARTER_DB) return 'belowQuarter'
  if (gain >= QUARTER_DB) return 'quarter'
  if (gain >= HALF_DB) return 'half'
  return gain >= MIN_GAIN ? 'some' : 'little'
}

function communityKey(diff: number): string {
  if (diff >= MIN_GAIN) return 'behind'
  return diff <= -MIN_GAIN ? 'ahead' : 'same'
}

export function PlainSummaries({ A }: { A: Take }) {
  const { t } = useTranslation()
  const inputs = useBench(useShallow((s) => ({ takes: s.takes, session: s.session, fxDist: s.fxDist })))
  const { model } = useMicProfile()
  const community = useCommunityMic(model)
  const lines = useMemo(() => {
    const out: string[] = []
    const pair = beforeAfterPair(inputs.takes, A, inputs.session, inputs.fxDist)
    const gain = pair ? pair.fx.analysis.snr - pair.raw.analysis.snr : Number.NaN
    if (Number.isFinite(gain)) out.push(t(`results.summary.beforeAfter.${beforeAfterKey(gain)}`, { db: fmtNum(gain, 0) }))
    const mine = community ? yourRawAnalysis(inputs.takes, A) : null
    const diff = community && mine ? community.rawSnr.median - mine.snr : Number.NaN
    if (Number.isFinite(diff)) out.push(t(`results.summary.community.${communityKey(diff)}`, { db: fmtNum(Math.abs(diff), 0) }))
    return out
  }, [inputs, A, community, t])
  if (!lines.length) return null
  return (
    <Paper className="grid gap-1.5 px-4 py-3" data-testid="plain-summaries">
      {lines.map((line) => (
        <Typography key={line} variant="body2">{line}</Typography>
      ))}
    </Paper>
  )
}
