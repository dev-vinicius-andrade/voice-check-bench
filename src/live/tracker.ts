// Hold + history + segments in one place (SPEC "Live tuning (v1.3)"). Framework-free and independent of Web Audio: the
// web LiveSession feeds it every update, and the desktop app can feed it from its own aligned stream the same way.
import type { Msg } from '../plain/types'
import type { VoiceGoal } from '../types'
import type { LiveFrames } from './frames'
import { EMPTY_HISTORY, markHistory, pushHistory, type LiveHistory } from './history'
import { holdMetrics, type HeldMetrics } from './hold'
import { LiveSegments, type SegmentSummary } from './segments'
import type { LiveMetrics, LiveSessionApi } from './types'

/** Everything a subscriber gets each update. Times are ms since Start. */
export interface LiveUpdate {
  /** The newest window, as LiveSessionApi.subscribe delivers it. */
  metrics: LiveMetrics
  held: HeldMetrics
  history: LiveHistory
  /** Segments kept, oldest first, the current one last. */
  segments: SegmentSummary[]
  sinceStart: SegmentSummary
}

/** The frames behind an update and the absolute sample (fx time) where they end. */
export interface FrameFeed {
  frames: LiveFrames
  end: number
}

export class LiveTracker {
  private held: HeldMetrics | null = null
  private history: LiveHistory = EMPTY_HISTORY
  private readonly segs = new LiveSegments()
  private lastT = 0

  /** Forgets everything (Start). */
  reset(t = 0): void {
    this.held = null
    this.history = EMPTY_HISTORY
    this.segs.reset(t)
    this.lastT = t
  }

  /** One update at time t (ms). feed null = no frames (only hold and history move). */
  update(m: LiveMetrics, feed: FrameFeed | null, t: number, goal: VoiceGoal): LiveUpdate {
    this.lastT = t
    this.held = holdMetrics(this.held, m, t)
    this.history = pushHistory(this.history, m, t)
    if (feed) this.segs.feed(feed.frames, feed.end, t)
    return { metrics: m, held: this.held, history: this.history, ...this.report(goal) }
  }

  /** "I changed something" at t (default: the latest update): a new segment and a history marker. */
  markChange(label: Msg, t = this.lastT): void {
    this.segs.markChange(label, t)
    this.history = markHistory(this.history, label, t)
  }

  report(goal: VoiceGoal): Pick<LiveUpdate, 'segments' | 'sinceStart'> {
    return { segments: this.segs.segments(goal), sinceStart: this.segs.sinceStart(goal) }
  }
}

/** LiveSessionApi plus hold, history and segments (what createLiveSession returns). */
export interface LiveTrackedSessionApi extends LiveSessionApi {
  /** Called every update with the metrics plus held values, history and segments. Returns an unsubscribe function. */
  subscribeUpdates(fn: (u: LiveUpdate) => void): () => void
  /** Starts a new segment and adds a history marker now. Ignored while stopped. */
  markChange(label: Msg): void
  /** Segments and the since-Start summary so far (still readable after Stop, until the next Start). */
  report(goal: VoiceGoal): Pick<LiveUpdate, 'segments' | 'sinceStart'>
}
