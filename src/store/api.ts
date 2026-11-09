// Store contract. Owned by the orchestrator: the store implementation (benchStore.ts, selectors.ts)
// and the UI components are written against this file in parallel. Change only with all parties.
import type { ChartView, DeviceChoice, DeviceKind, MicProfile, Screen, StepRef, Suggestion, Take, VoiceGoal } from '../types'
import type { InputDevice } from '../audio/AudioEngine'
import type { MainsSetting } from '../audio/mains'
import type { Msg } from '../plain/types'

export type MicStatus = 'off' | 'connecting' | 'on' | 'error'
export type RecorderPhase = 'idle' | 'silence' | 'reading' | 'analyzing'

/** Status line text is a message key (`engine.status.*`), rendered by StatusSnackbar. */
export interface StatusMessage {
  msg: Msg
  error: boolean
}

export interface BenchState {
  /** True once takes and prefs are loaded. */
  ready: boolean
  /** False when IndexedDB is blocked (takes live only in memory). */
  storageAvailable: boolean
  takes: Take[]
  screen: Screen
  /** Index into STEPS, or 'free'. */
  step: StepRef
  session: string
  A: number | null
  B: number | null
  view: ChartView
  /** Distance chosen for the processed take; null = use the best control's distance. */
  fxDist: string | null
  devices: InputDevice[]
  deviceChoice: DeviceChoice
  mic: { status: MicStatus; deviceId: string | null; label: string; error: Msg | null }
  recorder: { phase: RecorderPhase; /** seconds since record was pressed */ elapsed: number }
  /** Take recorded on the current free-take screen (guided steps use the session slot). */
  lastTakeId: number | null
  freeTakeName: string
  /** The person's mic (saved in localStorage key 'vcb-mic'; copied onto each new take). */
  micProfile: MicProfile
  /** Mains frequency setting (localStorage 'vcb-mains'); 'auto' resolves from the locale region at analysis time. */
  mains: MainsSetting
  /** Voice goal (style + perceived issues); every analysis-derived view targets it. */
  goal: VoiceGoal
  status: StatusMessage | null
}

export interface BenchActions {
  /** Load takes (re-analyzing them), restore prefs, auto-enable the mic when permission is already granted. Idempotent. */
  bootstrap(): Promise<void>
  /** Ask for the mic, list inputs, auto-pick raw/fx choices by name, open the device for the current step. */
  enableMic(): Promise<void>
  /** Save the choice for a device kind and open that input (so the meter shows it). */
  chooseDevice(kind: DeviceKind, deviceId: string): Promise<void>
  /** Open an input without changing the saved choices (Test buttons, free take). */
  previewDevice(deviceId: string): Promise<void>
  goTo(screen: Screen, step?: StepRef): void
  /** Next step, or results after the last step / free take. Guided results set A = processed, B = best control, view = 'diff' when both exist. */
  next(): void
  back(): void
  skip(): void
  /** Switches to the step's device kind first; then silence countdown (QUIET_SEC) → reading → auto-stop at MAX_SEC. */
  startRecording(): Promise<void>
  /** Stops, analyzes, saves (replacing nothing: older takes stay, the latest per step wins in the session). */
  stopRecording(): void
  toggleRecording(): void
  playTake(id: number): void
  stopPlayback(): void
  setA(id: number): void
  toggleB(id: number): void
  setView(view: ChartView): void
  deleteTake(id: number): void
  deleteAll(): void
  newSession(): void
  startFreeTake(): void
  setFreeTakeName(name: string): void
  setFxDist(dist: string): void
  setMicProfile(patch: Partial<MicProfile>): void
  setGoal(patch: Partial<VoiceGoal>): void
  /** Save the mains setting and re-analyze every take with it. */
  setMains(mains: MainsSetting): void
  setStatus(msg: Msg, error?: boolean): void
  clearStatus(): void
}

export type BenchStore = BenchState & BenchActions

/** A session's takes. The UI labels it: free takes, or "Session · <created, formatted>". */
export interface TakeGroup {
  session: string
  /** Session start (ms since epoch); null for the free-takes group. */
  created: number | null
  current: boolean
  takes: Take[]
}

/** Pure derived data. Implemented in selectors.ts. */
export interface BenchSelectors {
  /** Latest take per STEPS slot for the given session (default: current session). */
  selectSlots(s: BenchState, session?: string): (Take | null)[]
  selectBestControl(s: BenchState, session?: string): { dist: string; cm: number; take: Take } | null
  /** fxDist, else best control distance, else '8 cm'. */
  selectFxDist(s: BenchState): string
  /** Take shown on the current step screen: the session slot for guided steps, lastTakeId for free take. */
  selectStepTake(s: BenchState): Take | null
  selectTakeA(s: BenchState): Take | null
  selectTakeB(s: BenchState): Take | null
  /** Suggestion from the raw take at fxDist, else best control, else take A if it is a raw control. */
  selectSuggestion(s: BenchState): Suggestion | null
  /** Takes grouped by session, newest session first, takes oldest first inside a group. */
  selectTakeGroups(s: BenchState): TakeGroup[]
  /** Next enabled on the step screen. */
  selectCanGoNext(s: BenchState): boolean
}
