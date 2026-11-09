import { useEffect, useRef, useState } from 'react'
import Button from '@mui/material/Button'
import { useTranslation } from 'react-i18next'
import { useBench } from '../../store/benchStore'
import { useMicProfile, useSuggestion } from '../../store/hooks'
import type { Take } from '../../types'
import { downloadFile } from './download'
import { anonymizedSummary } from '../../community/summary'

/** Copies the anonymized JSON summary of A's session (no audio, device names, dates or ids); falls back to a file. */
export function CopySummaryButton({ A }: { A: Take }) {
  const mic = useMicProfile()
  const s = useSuggestion()
  const { t } = useTranslation()
  const [state, setState] = useState<'idle' | 'copied' | 'saved'>('idle')
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const copy = async (): Promise<void> => {
    const json = JSON.stringify(anonymizedSummary(useBench.getState().takes, A, mic, s), null, 2)
    try {
      await navigator.clipboard.writeText(json)
      setState('copied')
    } catch {
      downloadFile('voice-check-summary.json', json, 'application/json')
      setState('saved')
    }
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setState('idle'), 2000)
  }

  return (
    <Button
      size="small"
      variant="outlined"
      onClick={() => void copy()}
      title={t('results.share.copyTitle')}
    >
      {state === 'copied' ? t('results.copy.copied') : state === 'saved' ? t('results.copy.saved') : t('results.share.copy')}
    </Button>
  )
}
