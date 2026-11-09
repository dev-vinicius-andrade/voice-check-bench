// STUB — replaced by the store task. Keeps the UI compiling against src/store/api.ts.
import { create } from 'zustand'
import type { BenchStore } from './api'

const todo = (): never => {
  throw new Error('benchStore not implemented yet')
}

export const useBench = create<BenchStore>()(() => ({
  ready: false,
  storageAvailable: true,
  takes: [],
  screen: 'setup',
  step: 0,
  session: 's0',
  A: null,
  B: null,
  view: 'a',
  fxDist: null,
  devices: [],
  deviceChoice: { raw: null, fx: null },
  mic: { status: 'off', deviceId: null, label: '', error: null },
  recorder: { phase: 'idle', elapsed: 0 },
  lastTakeId: null,
  freeTakeName: '',
  status: null,
  bootstrap: todo,
  enableMic: todo,
  chooseDevice: todo,
  previewDevice: todo,
  goTo: todo,
  next: todo,
  back: todo,
  skip: todo,
  startRecording: todo,
  stopRecording: todo,
  toggleRecording: todo,
  playTake: todo,
  stopPlayback: todo,
  setA: todo,
  toggleB: todo,
  setView: todo,
  deleteTake: todo,
  deleteAll: todo,
  newSession: todo,
  startFreeTake: todo,
  setFreeTakeName: todo,
  setFxDist: todo,
  setStatus: todo,
  clearStatus: todo,
}))
