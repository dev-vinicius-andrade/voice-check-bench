// AudioWorkletProcessor 'recorder': while recording, averages the input channels to mono
// and posts Float32Array chunks of CHUNK frames to the main thread (buffer transferred).
// Messages in: {type:'start'} | {type:'stop'}. Messages out: Float32Array chunks.
// A partial chunk at stop is dropped (as the prototype's ScriptProcessor did).
const CHUNK = 4096

class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.recording = false
    this.buf = new Float32Array(CHUNK)
    this.fill = 0
    this.port.onmessage = (e) => {
      const type = e.data && e.data.type
      if (type === 'start') {
        this.fill = 0
        this.recording = true
      } else if (type === 'stop') {
        this.recording = false
        this.fill = 0
      }
    }
  }

  process(inputs, outputs) {
    for (const output of outputs) for (const ch of output) ch.fill(0)
    if (!this.recording) return true
    const input = inputs[0]
    if (!input || input.length === 0) return true
    const n = input[0].length
    const k = input.length
    for (let i = 0; i < n; i++) {
      let s = 0
      for (let c = 0; c < k; c++) s += input[c][i]
      this.buf[this.fill++] = s / k
      if (this.fill === CHUNK) {
        const out = this.buf
        this.port.postMessage(out, [out.buffer])
        this.buf = new Float32Array(CHUNK)
        this.fill = 0
      }
    }
    return true
  }
}

registerProcessor('recorder', RecorderProcessor)
