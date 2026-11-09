import Typography from '@mui/material/Typography'
import { useCommunityMic } from '../../community/useCommunity'

/** One muted line under "Your microphone" when the community has reports for this model. */
export function CommunityMicLine({ model }: { model: string }) {
  const m = useCommunityMic(model)
  if (!m) return null
  const people = m.reports === 1 ? '1 person' : `${m.reports} people`
  const dist = m.bestDistance[0]?.dist
  return (
    <Typography variant="body2" color="text.secondary">
      {people} shared results with this mic · typical raw SNR {m.rawSnr.median.toFixed(0)} dB
      {dist && ` · most voted distance ${dist}`}
    </Typography>
  )
}
