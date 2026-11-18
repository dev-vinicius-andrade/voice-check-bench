// Public API of the tuner (SPEC "Desktop app (v2.0)" → Tune from a recording).
export { retune, tune } from './tune'
export { engineChanges, valueChanges, type TuneValueChange } from './types'
export { DEFAULT_MAX_RENDERS, STAGE_RENDERS } from './session'
export { openTuneSession, type TuneBridge, type TuneSession } from './renderer'
export { targetsOf, type TuneCaps, type TuneTargets } from './targets'
export type {
  Bother,
  TakeSummary,
  TuneChange,
  TuneEffect,
  TuneGoals,
  TuneInput,
  TuneLogEntry,
  TuneMetric,
  TuneRender,
  TuneResult,
  TuneResume,
  TuneScore,
  TuneStage,
  TuneUse,
} from './types'
