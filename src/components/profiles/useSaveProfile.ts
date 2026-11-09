// "Save as profile" inputs for A's session: the validation gate (raw control vs processed take), the suggested
// name (host + style) and the save action (profileFromSession → profiles store).
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { canValidate, profileFromSession, sessionValidation, suggestProfileName } from '../../profiles/build'
import { openProfilesStore } from '../../profiles/store'
import type { ProfileHost } from '../../profiles/types'
import { suggestionToJson } from '../../settings/suggest'
import { useBench } from '../../store/benchStore'
import { useSuggestion } from '../../store/hooks'
import type { Analysis, Take } from '../../types'
import { loadHost } from '../guide/hostPref'
import { beforeAfterPair } from '../results/roomNoise'

export interface SaveGate {
  ok: boolean
  reason: 'noFx' | 'gain' | 'regressions' | null
  rawScore?: number
  fxScore?: number
}

export interface SaveProfile {
  /** null when there is no suggestion to save. */
  gate: SaveGate | null
  suggestedName: string
  save(name: string): Promise<void>
}

/** Gate from the session's raw/processed pair (pure; exported for tests). */
export function saveGate(raw: Analysis | null, fx: Analysis | null, goal: Parameters<typeof sessionValidation>[2]): SaveGate {
  const v = sessionValidation(raw, fx, goal)
  if (!v) return { ok: false, reason: 'noFx' }
  const scores = { rawScore: v.rawScore, fxScore: v.fxScore }
  const regressions = v.regressions.length > 0
  if (canValidate(v)) return { ok: true, reason: null, ...scores }
  return { ok: false, reason: regressions ? 'regressions' : 'gain', ...scores }
}

const profileHost = (): ProfileHost => {
  const h = loadHost()
  return h && h !== 'unsure' ? h : null
}

export function useSaveProfile(A: Take): SaveProfile {
  const { t } = useTranslation()
  const s = useSuggestion()
  const st = useBench(useShallow((x) => ({ takes: x.takes, session: x.session, fxDist: x.fxDist, goal: x.goal, mic: x.micProfile, mains: x.mains, devices: x.deviceChoice })))
  const pair = useMemo(() => beforeAfterPair(st.takes, A, st.session, st.fxDist), [st.takes, A, st.session, st.fxDist])
  const raw = pair?.raw.analysis ?? null
  const fx = pair?.fx.analysis ?? null
  const gate = useMemo(() => (s ? saveGate(raw, fx, st.goal) : null), [s, raw, fx, st.goal])
  const host = profileHost()
  const suggestedName = suggestProfileName(host, st.goal.style, t(`wizard.goal.style.${st.goal.style}.name`))

  const save = async (name: string): Promise<void> => {
    if (!s) return
    const p = profileFromSession({
      name,
      mic: A.mic ?? st.mic,
      host,
      dist: s.dist,
      goal: st.goal,
      mains: st.mains,
      suggestion: suggestionToJson(s),
      devices: st.devices,
      // validation is kept only when the gate passes; otherwise the profile is a "not validated" draft
      raw,
      fx,
    })
    await (await openProfilesStore()).put(p)
  }
  return { gate, suggestedName, save }
}
