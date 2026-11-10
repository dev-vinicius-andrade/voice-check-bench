// AudioWorkletProcessor 'tap' (live tuning): always averages the input channels to mono and posts
// { frame, samples } messages of CHUNK frames to the main thread (samples buffer transferred).
// `frame` is the AudioContext frame of samples[0] (currentFrame of the render quantum + offset), so two taps in the
// same context can be lined up sample by sample. No messages in; quanta without an input channel post nothing.
// The output is silent (connect it to a muted gain so the graph pulls it).
const CHUNK = 1024

class TapProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buf = new Float32Array(CHUNK)
    this.fill = 0
    this.start = 0
  }

  process(inputs, outputs) {
    for (const output of outputs) for (const ch of output) ch.fill(0)
    const input = inputs[0]
    if (!input || input.length === 0) {
      // no input this quantum: drop the partial chunk so every posted chunk is contiguous from its `frame`
      this.fill = 0
      return true
    }
    const n = input[0].length
    const k = input.length
    for (let i = 0; i < n; i++) {
      if (this.fill === 0) this.start = currentFrame + i
      let s = 0
      for (let c = 0; c < k; c++) s += input[c][i]
      this.buf[this.fill++] = s / k
      if (this.fill === CHUNK) {
        const samples = this.buf
        this.port.postMessage({ frame: this.start, samples }, [samples.buffer])
        this.buf = new Float32Array(CHUNK)
        this.fill = 0
      }
    }
    return true
  }
}

registerProcessor('tap', TapProcessor)
