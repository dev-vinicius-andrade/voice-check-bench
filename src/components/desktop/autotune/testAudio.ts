// Test-only: a Web Audio stand-in (jsdom has none) that records the buffer sources it creates.
import { vi } from 'vitest'

interface FakeBuffer {
  duration: number
  data: Float32Array
  copyToChannel(x: Float32Array): void
}

export interface FakeSource {
  buffer: FakeBuffer | null
  onended: (() => void) | null
  connect: ReturnType<typeof vi.fn>
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
}

class FakeContext {
  currentTime = 0
  destination = {}
  readonly sources: FakeSource[]
  constructor(sources: FakeSource[]) {
    this.sources = sources
  }
  createBuffer(_channels: number, length: number, rate: number): FakeBuffer {
    const b: FakeBuffer = { duration: length / rate, data: new Float32Array(0), copyToChannel: (x) => (b.data = x.slice()) }
    return b
  }
  createBufferSource(): FakeSource {
    const s: FakeSource = { buffer: null, onended: null, connect: vi.fn(), start: vi.fn(), stop: vi.fn() }
    this.sources.push(s)
    return s
  }
  resume = vi.fn(async () => undefined)
  close = vi.fn(async () => undefined)
}

export interface FakeAudio {
  sources: FakeSource[]
  /** The context the player created (throws before the first Play). */
  ctx(): FakeContext
  uninstall(): void
}

export function installFakeAudio(): FakeAudio {
  const sources: FakeSource[] = []
  const made: FakeContext[] = []
  const w = window as unknown as Record<string, unknown>
  w.AudioContext = class extends FakeContext {
    constructor() {
      super(sources)
      made.push(this)
    }
  }
  return {
    sources,
    ctx: () => {
      const c = made[made.length - 1]
      if (!c) throw new Error('no AudioContext yet')
      return c
    },
    uninstall: () => {
      delete w.AudioContext
    },
  }
}
