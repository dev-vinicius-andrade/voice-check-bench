import { useEffect, useRef, useState } from 'react'
import Button from '@mui/material/Button'
import { useBench } from '../../store/benchStore'
import { useMicProfile, useSuggestion } from '../../store/hooks'
import type { Take } from '../../types'
import { downloadFile } from './download'
import { anonymizedSummary } from './roomNoise'

const IDLE = 'Copy anonymized summary'

/** Copies the anonymized JSON summary of A's session (no audio, device names, dates or ids); falls back to a file. */
export function CopySummaryButton({ A }: { A: Take }) {
  const mic = useMicProfile()
  const s = useSuggestion()
  const [label, setLabel] = useState(IDLE)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const copy = async (): Promise<void> => {
    const json = JSON.stringify(anonymizedSummary(useBench.getState().takes, A, mic, s), null, 2)
    try {
      await navigator.clipboard.writeText(json)
      setLabel('Copied ✓')
    } catch {
      downloadFile('voice-check-summary.json', json, 'application/json')
      setLabel('Saved as file')
    }
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setLabel(IDLE), 2000)
  }

  return (
    <Button
      size="small"
      variant="outlined"
      onClick={() => void copy()}
      title="Mic profile, analysis numbers and suggested values for this session. No audio, device names or dates."
    >
      {label}
    </Button>
  )
}
