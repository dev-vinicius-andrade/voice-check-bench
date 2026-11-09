// Known microphones (suggestion list for the "Your microphone" card) and mic-dependent advice. Pure.
import type { MicProfile } from '../types'

/** Common USB/XLR podcast mics. Picking one pre-fills kind/pattern/address; the person can change them. */
export const MIC_CATALOG: readonly MicProfile[] = [
  { model: 'Fifine K688', kind: 'dynamic', pattern: 'cardioid', address: 'end' },
  { model: 'Fifine K669', kind: 'condenser', pattern: 'cardioid', address: 'end' },
  { model: 'Shure SM58', kind: 'dynamic', pattern: 'cardioid', address: 'end' },
  { model: 'Shure SM7B', kind: 'dynamic', pattern: 'cardioid', address: 'end' },
  { model: 'Shure MV7', kind: 'dynamic', pattern: 'cardioid', address: 'end' },
  { model: 'Rode PodMic', kind: 'dynamic', pattern: 'cardioid', address: 'end' },
  { model: 'Rode NT-USB', kind: 'condenser', pattern: 'cardioid', address: 'side' },
  { model: 'Audio-Technica AT2020', kind: 'condenser', pattern: 'cardioid', address: 'side' },
  { model: 'Audio-Technica AT2005USB', kind: 'dynamic', pattern: 'cardioid', address: 'end' },
  { model: 'Blue Yeti', kind: 'condenser', pattern: 'cardioid', address: 'side' },
  { model: 'HyperX QuadCast', kind: 'condenser', pattern: 'cardioid', address: 'end' },
  { model: 'Elgato Wave:3', kind: 'condenser', pattern: 'cardioid', address: 'side' },
  { model: 'Samson Q2U', kind: 'dynamic', pattern: 'cardioid', address: 'end' },
  { model: 'Maono PD200X', kind: 'dynamic', pattern: 'cardioid', address: 'end' },
]

export const DEFAULT_MIC: MicProfile = { model: '', kind: 'unknown', pattern: 'unknown', address: 'unknown' }

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ')

/** Catalog entry whose model matches (case- and spacing-insensitive), else undefined. */
export function findMic(model: string): MicProfile | undefined {
  const m = norm(model)
  return m ? MIC_CATALOG.find((e) => norm(e.model) === m) : undefined
}

/** Where to speak into the mic. */
export function addressTip(mic: Pick<MicProfile, 'address'>): string {
  if (mic.address === 'end') return 'Speak straight into the top of the mic.'
  if (mic.address === 'side') return 'Speak into the front side of the mic (usually where the logo is), not the top.'
  return 'Point the capsule at your mouth.'
}

/** How to place the mic relative to the loudest noise source, from its pickup pattern. */
export function placementTip(mic: Pick<MicProfile, 'pattern'>): string {
  if (mic.pattern === 'cardioid') return 'Point the back of the mic at the loudest noise source (fan, PC, server).'
  if (mic.pattern === 'supercardioid') return "Keep the loudest noise at the mic's sides, about 125° off-axis."
  return "Move the mic closer to you and away from the noise; this pickup pattern won't reject it."
}
