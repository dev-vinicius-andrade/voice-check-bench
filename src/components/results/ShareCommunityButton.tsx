import { useMemo } from 'react'
import Button from '@mui/material/Button'
import Tooltip from '@mui/material/Tooltip'
import GitHubIcon from '@mui/icons-material/GitHub'
import { buildShareUrl } from '../../community/shareUrl'
import { anonymizedSummary } from '../../community/summary'
import { useBench } from '../../store/benchStore'
import { useMicProfile, useSuggestion } from '../../store/hooks'
import type { Take } from '../../types'

const LABEL = 'Share with the community'

/**
 * Opens the pre-filled "Mic result" GitHub issue form in a new tab. When the summary does not fit in the link,
 * the click also copies it to the clipboard and `onTruncated` lets the parent show how to paste it.
 */
export function ShareCommunityButton({ A, onTruncated }: { A: Take; onTruncated: () => void }) {
  const mic = useMicProfile()
  const s = useSuggestion()
  const takes = useBench((st) => st.takes)
  const share = useMemo(() => {
    const summary = anonymizedSummary(takes, A, mic, s)
    return { ...buildShareUrl(summary), summary }
  }, [takes, A, mic, s])

  if (!mic.model.trim()) {
    return (
      <Tooltip title="Set your mic model on the setup screen first">
        <span>
          <Button size="small" variant="outlined" color="primary" startIcon={<GitHubIcon />} disabled>
            {LABEL}
          </Button>
        </span>
      </Tooltip>
    )
  }

  const onClick = (): void => {
    if (!share.truncated) return
    onTruncated()
    navigator.clipboard?.writeText(JSON.stringify(share.summary, null, 2)).catch(() => undefined)
  }

  return (
    <Button
      size="small"
      variant="outlined"
      color="primary"
      startIcon={<GitHubIcon />}
      component="a"
      href={share.url}
      target="_blank"
      rel="noopener"
      onClick={onClick}
    >
      {LABEL}
    </Button>
  )
}
