// Lazily created AudioEngine singleton shared by the store and hooks. Tests replace it with vi.mock('./engine').
import { AudioEngine } from '../audio/AudioEngine'

let engine: AudioEngine | null = null

export function getEngine(): AudioEngine {
  engine ??= new AudioEngine()
  return engine
}
