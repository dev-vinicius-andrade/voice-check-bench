// Open state of the "Show the technical details" section, remembered in localStorage (fails soft when blocked).
import { useCallback, useState } from 'react'

const KEY = 'vcb-results-details'

function readOpen(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function useDetailsOpen(): [boolean, (open: boolean) => void] {
  const [open, setOpenState] = useState(readOpen)
  const setOpen = useCallback((v: boolean) => {
    setOpenState(v)
    try {
      localStorage.setItem(KEY, v ? '1' : '0')
    } catch {
      // storage blocked: the choice lasts for this visit only
    }
  }, [])
  return [open, setOpen]
}
