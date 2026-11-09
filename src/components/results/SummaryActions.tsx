import { useState } from 'react'
import Typography from '@mui/material/Typography'
import type { Take } from '../../types'
import { CopySummaryButton } from './CopySummaryButton'
import { ShareCommunityButton } from './ShareCommunityButton'

/** Copy / share buttons for A's anonymized summary, with what sharing does. */
export function SummaryActions({ A }: { A: Take }) {
  const [truncated, setTruncated] = useState(false)
  return (
    <div className="grid justify-items-end gap-1">
      <div className="flex flex-wrap justify-end gap-2">
        <CopySummaryButton A={A} />
        <ShareCommunityButton A={A} onTruncated={() => setTruncated(true)} />
      </div>
      <Typography variant="caption" color="text.secondary" className="text-right" sx={{ maxWidth: '52ch' }}>
        Opens a public GitHub issue with your mic profile and analysis numbers (no audio). You review it before posting.
      </Typography>
      {truncated && (
        <Typography variant="caption" color="text.secondary" className="text-right" sx={{ maxWidth: '52ch' }}>
          The summary was too long for the link: paste it into the Summary field.
        </Typography>
      )}
    </div>
  )
}
