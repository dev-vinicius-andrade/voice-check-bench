// Loads takes and prefs once on mount (bootstrap itself is idempotent, so StrictMode double effects are safe).
import { useEffect } from 'react'
import { useBench } from '../store/benchStore'

export function useBootstrap(): void {
  useEffect(() => {
    void useBench.getState().bootstrap()
  }, [])
}
