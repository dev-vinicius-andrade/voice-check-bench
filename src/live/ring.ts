// Fixed-size float ring buffer for live capture (SPEC "Live tuning (v1.3)"). Framework-free.
// Samples are addressed by an absolute frame number (the AudioContext frame the tap worklet stamps on each chunk), so
// two inputs of the same context can be read over exactly the same stretch of time.

export class FloatRing {
  readonly capacity: number
  private readonly buf: Float32Array
  /** Index in `buf` of the next sample to write. */
  private pos = 0
  /** Samples currently held (≤ capacity). */
  private count = 0
  /** Absolute frame just after the newest sample. */
  private endFrame = 0

  constructor(capacity: number) {
    if (!(capacity >= 1)) throw new RangeError('FloatRing capacity must be at least 1')
    this.capacity = Math.floor(capacity)
    this.buf = new Float32Array(this.capacity)
  }

  /** Samples held, 0..capacity. */
  get length(): number {
    return this.count
  }

  /** Absolute frame just after the newest sample. */
  get end(): number {
    return this.endFrame
  }

  /** Absolute frame of the oldest sample held. */
  get start(): number {
    return this.endFrame - this.count
  }

  clear(): void {
    this.pos = 0
    this.count = 0
    this.endFrame = 0
  }

  /**
   * Appends a chunk. `startFrame` (optional) is the absolute frame of chunk[0]: when it does not continue the newest
   * sample (a gap or an overlap), the ring is emptied first so it never holds made-up samples. Without it the chunk
   * simply continues the stream.
   */
  write(chunk: ArrayLike<number>, startFrame?: number): void {
    const n = chunk.length
    if (startFrame !== undefined && (this.count === 0 || startFrame !== this.endFrame)) {
      this.pos = 0
      this.count = 0
      this.endFrame = startFrame
    }
    // only the newest `capacity` samples of a huge chunk can survive
    const skip = Math.max(0, n - this.capacity)
    const cap = this.capacity
    for (let i = skip; i < n; i++) {
      this.buf[this.pos] = chunk[i]
      this.pos = this.pos + 1 === cap ? 0 : this.pos + 1
    }
    this.count = Math.min(cap, this.count + n)
    this.endFrame += n
  }

  /** Copies the newest `dst.length` samples into dst, oldest first. False (dst untouched) when fewer are held. */
  readLast(dst: Float32Array): boolean {
    return this.readEnding(dst, this.endFrame)
  }

  /**
   * Copies the `dst.length` samples that end just before absolute frame `endFrame` into dst, oldest first.
   * False (dst untouched) when that stretch is not entirely held.
   */
  readEnding(dst: Float32Array, endFrame: number): boolean {
    const n = dst.length
    if (endFrame > this.endFrame || endFrame - n < this.start) return false
    const cap = this.capacity
    // index of the sample at absolute frame endFrame - n
    let i = (this.pos - (this.endFrame - endFrame) - n) % cap
    if (i < 0) i += cap
    for (let k = 0; k < n; k++) {
      dst[k] = this.buf[i]
      i = i + 1 === cap ? 0 : i + 1
    }
    return true
  }
}
