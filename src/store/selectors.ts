// Pure derived data (BenchSelectors in api.ts), ported from the prototype. Selectors that build new
// arrays/objects must not be passed to useBench directly: use the hooks in ./hooks.ts instead.
import { bestControl, sessionSlots } from '../session/bestControl'
import { pickSuggestionBase, suggest } from '../settings/suggest'
import { isAnalysisError, type Suggestion, type Take } from '../types'
import type { BenchState } from './api'

type S<K extends keyof BenchState> = Pick<BenchState, K>

const byId = (takes: readonly Take[], id: number | null): Take | null =>
  id === null ? null : (takes.find((t) => t.id === id) ?? null)

const isRawControl = (t: Take | null): t is Take =>
  !!t && !isAnalysisError(t.analysis) && (t.step === 'c2' || t.step === 'c8' || t.step === 'c15')

export const selectSlots = (s: S<'takes' | 'session'>, session: string = s.session): (Take | null)[] =>
  sessionSlots(s.takes, session)

export const selectBestControl = (
  s: S<'takes' | 'session'>,
  session?: string,
): { dist: string; cm: number; take: Take } | null => bestControl(selectSlots(s, session))

export const selectFxDist = (s: S<'takes' | 'session' | 'fxDist'>): string =>
  s.fxDist || selectBestControl(s)?.dist || '8 cm'

export const selectStepTake = (s: S<'takes' | 'session' | 'step' | 'lastTakeId'>): Take | null =>
  s.step === 'free' ? byId(s.takes, s.lastTakeId) : (selectSlots(s)[s.step] ?? null)

export const selectTakeA = (s: S<'takes' | 'A'>): Take | null => byId(s.takes, s.A)
export const selectTakeB = (s: S<'takes' | 'B'>): Take | null => byId(s.takes, s.B)

/**
 * Prototype suggestBase(): uses the session of take A (unless A is a free take, then the current
 * session); raw take at fxDist → best control → A itself if it is an analyzed raw control.
 */
export const selectSuggestion = (s: S<'takes' | 'session' | 'fxDist' | 'A'>): Suggestion | null => {
  const A = selectTakeA(s)
  const sid = A && A.session !== 'free' ? A.session : s.session
  const base = pickSuggestionBase(selectSlots(s, sid), s.fxDist) ?? (isRawControl(A) ? A : null)
  return base ? suggest(base, selectFxDist(s)) : null
}

function sessionLabel(takes: readonly Take[], sid: string): string {
  if (sid === 'free') return 'Free takes'
  const t = takes.find((x) => x.session === sid)
  const d = new Date(t?.created ?? Number(sid.slice(1)))
  return `Session · ${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

export const selectTakeGroups = (
  s: S<'takes' | 'session'>,
): { session: string; label: string; current: boolean; takes: Take[] }[] => {
  const sessions = [...new Set([...s.takes].sort((a, b) => b.id - a.id).map((t) => t.session))]
  return sessions.map((sid) => ({
    session: sid,
    label: sessionLabel(s.takes, sid),
    current: sid === s.session,
    takes: s.takes.filter((t) => t.session === sid).sort((a, b) => a.id - b.id),
  }))
}

/** Also false while recording or analyzing (the prototype disables Next then). */
export const selectCanGoNext = (s: S<'takes' | 'session' | 'step' | 'lastTakeId' | 'recorder'>): boolean => {
  if (s.recorder.phase !== 'idle') return false
  const t = selectStepTake(s)
  return !!t && !isAnalysisError(t.analysis)
}
