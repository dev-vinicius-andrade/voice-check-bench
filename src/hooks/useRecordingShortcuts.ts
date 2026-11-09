// Step screen keyboard shortcuts (prototype): Space toggles recording, Enter goes to the next step.
// The record button is recognised by `recordButtonRef` or a `data-record-button` attribute.
import { useEffect, type RefObject } from 'react'
import { useBench } from '../store/benchStore'
import { selectCanGoNext } from '../store/selectors'

const FIELD_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA'])

export function useRecordingShortcuts(recordButtonRef?: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const isRecordButton = (el: HTMLElement): boolean =>
      el === recordButtonRef?.current || el.closest('[data-record-button]') !== null

    const onKeyDown = (e: KeyboardEvent): void => {
      const s = useBench.getState()
      if (s.screen !== 'step') return
      const el = e.target instanceof HTMLElement ? e.target : null
      const tag = el?.tagName ?? ''
      if (FIELD_TAGS.has(tag) || el?.isContentEditable) return
      if (e.code === 'Space') {
        if (e.repeat) return
        if (tag === 'BUTTON' && el && !isRecordButton(el)) return
        e.preventDefault()
        if (s.mic.status === 'on') s.toggleRecording()
      } else if (e.key === 'Enter') {
        if (tag === 'BUTTON' || !selectCanGoNext(s)) return
        e.preventDefault()
        s.next()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [recordButtonRef])
}
