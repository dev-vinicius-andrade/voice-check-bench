// Audio input, level metering, mono recording (AudioWorklet) and playback. No React.

export interface InputDevice {
  deviceId: string
  label: string
}

const SAMPLE_RATE = 48000
const LEVEL_FLOOR = -120

const isDeviceMissing = (e: unknown): boolean =>
  e instanceof Error && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError')

export class AudioEngine {
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private recorder: AudioWorkletNode | null = null
  private ready: Promise<void> | null = null
  private stream: MediaStream | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private device: InputDevice | null = null
  private chunks: Float32Array[] = []
  private recording = false
  private recStart = 0
  private playing: AudioBufferSourceNode | null = null
  private timeData: Float32Array<ArrayBuffer> | null = null

  isSupported(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      typeof navigator.mediaDevices?.getUserMedia === 'function' &&
      typeof AudioWorkletNode !== 'undefined'
    )
  }

  get current(): InputDevice | null {
    return this.device
  }

  get sampleRate(): number {
    return this.ctx?.sampleRate ?? SAMPLE_RATE
  }

  get recordingTime(): number {
    return this.recording && this.ctx ? this.ctx.currentTime - this.recStart : 0
  }

  /** Lazily creates the context and analyser; the worklet module loads asynchronously. */
  private ensureCtx(): AudioContext {
    if (this.ctx) return this.ctx
    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 4096
    this.ctx = ctx
    this.analyser = analyser
    this.ready = ctx.audioWorklet
      .addModule(`${import.meta.env.BASE_URL}worklets/recorder-worklet.js`)
      .then(() => {
        const node = new AudioWorkletNode(ctx, 'recorder', { numberOfInputs: 1, numberOfOutputs: 1 })
        node.port.onmessage = (e: MessageEvent<unknown>) => {
          if (this.recording && e.data instanceof Float32Array) this.chunks.push(e.data)
        }
        const mute = ctx.createGain()
        mute.gain.value = 0
        node.connect(mute)
        mute.connect(ctx.destination)
        this.recorder = node
        this.source?.connect(node)
      })
    return ctx
  }

  private stopStream(): void {
    this.stream?.getTracks().forEach((t) => t.stop())
    this.source?.disconnect()
    this.stream = null
    this.source = null
  }

  async open(deviceId?: string): Promise<InputDevice> {
    this.stopStream()
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: { ideal: 2 },
        sampleRate: { ideal: SAMPLE_RATE },
      },
    })
    const ctx = this.ensureCtx()
    await ctx.resume()
    await this.ready
    const source = ctx.createMediaStreamSource(stream)
    if (this.analyser) source.connect(this.analyser)
    if (this.recorder) source.connect(this.recorder)
    this.stream = stream
    this.source = source
    const track = stream.getAudioTracks()[0]
    this.device = {
      deviceId: track?.getSettings().deviceId ?? deviceId ?? '',
      label: track?.label ?? '',
    }
    return this.device
  }

  /** Opens deviceId; if it no longer exists, falls back to the default input. */
  async openWithFallback(deviceId?: string): Promise<InputDevice> {
    try {
      return await this.open(deviceId)
    } catch (e) {
      if (deviceId && isDeviceMissing(e)) return this.open(undefined)
      throw e
    }
  }

  async listInputs(): Promise<InputDevice[]> {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices
      .filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
      .map((d) => ({ deviceId: d.deviceId, label: d.label }))
  }

  /** Current RMS level in dBFS, floored at -120. */
  level(): number {
    const an = this.analyser
    if (!an || !this.source) return LEVEL_FLOOR
    if (!this.timeData || this.timeData.length !== an.fftSize) this.timeData = new Float32Array(an.fftSize)
    an.getFloatTimeDomainData(this.timeData)
    let s = 0
    for (const v of this.timeData) s += v * v
    const db = 10 * Math.log10(s / this.timeData.length)
    return Number.isFinite(db) ? Math.max(LEVEL_FLOOR, db) : LEVEL_FLOOR
  }

  startRecording(): void {
    if (!this.ctx || !this.recorder) throw new Error('Microphone is not open')
    this.chunks = []
    this.recording = true
    this.recStart = this.ctx.currentTime
    this.recorder.port.postMessage({ type: 'start' })
  }

  stopRecording(): Float32Array {
    this.recorder?.port.postMessage({ type: 'stop' })
    this.recording = false
    const total = this.chunks.reduce((n, c) => n + c.length, 0)
    const out = new Float32Array(total)
    let off = 0
    for (const c of this.chunks) {
      out.set(c, off)
      off += c.length
    }
    this.chunks = []
    return out
  }

  play(samples: Float32Array, sampleRate: number): void {
    this.stopPlayback()
    if (samples.length === 0) return
    const ctx = this.ensureCtx()
    void ctx.resume()
    const buffer = ctx.createBuffer(1, samples.length, sampleRate)
    buffer.getChannelData(0).set(samples)
    const node = ctx.createBufferSource()
    node.buffer = buffer
    node.connect(ctx.destination)
    node.onended = () => {
      if (this.playing === node) this.playing = null
    }
    node.start()
    this.playing = node
  }

  stopPlayback(): void {
    if (!this.playing) return
    try {
      this.playing.stop()
    } catch {
      // already stopped
    }
    this.playing = null
  }

  dispose(): void {
    this.stopPlayback()
    if (this.recording) this.stopRecording()
    this.stopStream()
    this.recorder?.disconnect()
    this.recorder = null
    this.analyser = null
    this.device = null
    this.ready = null
    void this.ctx?.close()
    this.ctx = null
  }
}
