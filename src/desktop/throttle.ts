// Rate limit for live slider changes (at most one send per interval; the latest value always goes out). Framework-free.

export interface Throttle<T> {
  /** Sends now when the interval since the last send has passed, else keeps the value for the next slot. */
  push(v: T): void
  /** Sends a kept value right away (slider released). */
  flush(): void
  /** Drops a kept value. */
  cancel(): void
}

export interface ThrottleClock {
  now: () => number
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (id: unknown) => void
}

const realClock: ThrottleClock = {
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
}

/** Live changes per second at most (SPEC: slider changes throttled to ≤ 20 per second). */
export const MAX_SENDS_PER_SEC = 20

export function throttle<T>(send: (v: T) => void, intervalMs = 1000 / MAX_SENDS_PER_SEC, clock: ThrottleClock = realClock): Throttle<T> {
  let last = -Infinity
  let pending: { v: T } | null = null
  let timer: unknown = null
  const fire = (): void => {
    timer = null
    if (!pending) return
    const { v } = pending
    pending = null
    last = clock.now()
    send(v)
  }
  return {
    push(v) {
      pending = { v }
      const wait = last + intervalMs - clock.now()
      if (wait <= 0) {
        if (timer !== null) clock.clearTimer(timer)
        fire()
      } else if (timer === null) timer = clock.setTimer(fire, wait)
    },
    flush() {
      if (timer !== null) clock.clearTimer(timer)
      fire()
    },
    cancel() {
      if (timer !== null) clock.clearTimer(timer)
      timer = null
      pending = null
    },
  }
}
