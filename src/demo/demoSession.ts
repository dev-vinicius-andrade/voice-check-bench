// "See an example result": loads the in-memory demo session into the bench store and opens results.
// The person's own takes stay; demo takes live in session 'demo' and are never written to IndexedDB.
import { create } from 'zustand'
import { prepareResults, useBench } from '../store/benchStore'
import type { Take } from '../types'
import { DEMO_SESSION, buildDemoTakes } from './demoTakes'

interface DemoState {
  /** True while demo takes are loaded in the bench store. */
  active: boolean
  /** The results banner was closed (the demo stays loaded). */
  dismissed: boolean
}

export const useDemo = create<DemoState>()(() => ({ active: false, dismissed: false }))

const isDemo = (t: Take): boolean => t.session === DEMO_SESSION

function applyDemo(): void {
  const s = useBench.getState()
  if (s.recorder.phase !== 'idle') return
  const takes = [...s.takes.filter((t) => !isDemo(t)), ...buildDemoTakes()]
  useBench.setState({ takes })
  useDemo.setState({ active: true, dismissed: false })
  useBench.getState().goTo('results')
  // goTo prepares A/B for the person's own session; the demo shows its own session instead.
  const ab = prepareResults({ ...useBench.getState(), session: DEMO_SESSION, A: null, B: null })
  useBench.setState({ B: null, view: 'a', ...ab })
}

/** Builds and analyzes the demo takes (after bootstrap has loaded the real ones), sets A/B and opens results. */
export function loadDemoSession(): void {
  if (useBench.getState().ready) {
    applyDemo()
    return
  }
  const unsubscribe = useBench.subscribe((s) => {
    if (!s.ready) return
    unsubscribe()
    applyDemo()
  })
}

/** Removes the demo takes from memory (the database never had them) and goes to setup. */
export function exitDemo(): void {
  const s = useBench.getState()
  const demoIds = new Set(s.takes.filter(isDemo).map((t) => t.id))
  const A = s.A !== null && demoIds.has(s.A) ? null : s.A
  const B = s.B !== null && demoIds.has(s.B) ? null : s.B
  useBench.setState({ takes: s.takes.filter((t) => !isDemo(t)), A, B, view: B === null ? 'a' : s.view })
  useDemo.setState({ active: false, dismissed: false })
  useBench.getState().goTo('setup')
}

/** Hides the results banner; the demo takes stay until exitDemo or a reload. */
export function dismissDemoBanner(): void {
  useDemo.setState({ dismissed: true })
}
