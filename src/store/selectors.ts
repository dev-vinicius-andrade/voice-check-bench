// Pure derived data (BenchSelectors in api.ts), ported from the prototype. Selectors that build new
// arrays/objects must not be passed to useBench directly: use the hooks in ./hooks.ts instead.
import { bestControl, sessionSlots } from '../session/bestControl'
import { pickSuggestionBase, suggest } from '../settings/suggest'
import { DEFAULT_GOAL, isAnalysisError, type Suggestion, type Take, type VoiceGoal } from '../types'
import type { BenchState, TakeGroup } from './api'

type S<K extends keyof BenchState> = Pick<BenchState, K>
/** The voice goal is optional in selector inputs: missing = DEFAULT_GOAL (natural, nothing perceived). */
type G = { goal?: VoiceGoal }
const goalOf = (s: G): VoiceGoal => s.goal ?? DEFAULT_GOAL

const byId = (takes: readonly Take[], id: number | null): Take | null =>
  id === null ? null : (takes.find((t) => t.id === id) ?? null)

const isRawControl = (t: Take | null): t is Take =>
  !!t && !isAnalysisError(t.analysis) && (t.step === 'c2' || t.step === 'c8' || t.step === 'c15')

export const selectSlots = (s: S<'takes' | 'session'>, session: string = s.session): (Take | null)[] =>
  sessionSlots(s.takes, session)

export const selectBestControl = (
  s: S<'takes' | 'session'> & G,
  session?: string,
): { dist: string; cm: number; take: Take } | null => bestControl(selectSlots(s, session), goalOf(s))

export const selectFxDist = (s: S<'takes' | 'session' | 'fxDist'> & G): string =>
  s.fxDist || selectBestControl(s)?.dist || '8 cm'

export const selectStepTake = (s: S<'takes' | 'session' | 'step' | 'lastTakeId'>): Take | null =>
  s.step === 'free' ? byId(s.takes, s.lastTakeId) : (selectSlots(s)[s.step] ?? null)

export const selectTakeA = (s: S<'takes' | 'A'>): Take | null => byId(s.takes, s.A)
export const selectTakeB = (s: S<'takes' | 'B'>): Take | null => byId(s.takes, s.B)

/**
 * Prototype suggestBase(): uses the session of take A (unless A is a free take, then the current
 * session); raw take at fxDist → best control → A itself if it is an analyzed raw control. EQ targets the voice goal.
 */
export const selectSuggestion = (s: S<'takes' | 'session' | 'fxDist' | 'A'> & G): Suggestion | null => {
  const A = selectTakeA(s)
  const sid = A && A.session !== 'free' ? A.session : s.session
  const goal = goalOf(s)
  const base = pickSuggestionBase(selectSlots(s, sid), s.fxDist, goal) ?? (isRawControl(A) ? A : null)
  return base ? suggest(base, selectFxDist(s), base.mic, goal) : null
}

/** When a session started: its first take, else the timestamp in its id ('s' + Date.now()); null for free takes. */
function sessionCreated(takes: readonly Take[], sid: string): number | null {
  if (sid === 'free') return null
  const t = takes.find((x) => x.session === sid)
  const ms = t ? Date.parse(t.created) : Number(sid.slice(1))
  return Number.isFinite(ms) ? ms : null
}

export const selectTakeGroups = (s: S<'takes' | 'session'>): TakeGroup[] => {
  const sessions = [...new Set([...s.takes].sort((a, b) => b.id - a.id).map((t) => t.session))]
  return sessions.map((sid) => ({
    session: sid,
    created: sessionCreated(s.takes, sid),
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
