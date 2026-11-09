// Known microphones (suggestion list for the "Your microphone" card) and mic-dependent advice. Pure.
import type { Msg } from '../plain/types'
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

/** Label of the "Other / not listed" choice. Picking it stores model '' (never a translated label). */
export const MIC_OTHER_LABEL: Msg = { key: 'engine.mic.other' }

/** Where to speak into the mic (`engine.mic.address.<end|side|unknown>`). */
export const addressTip = (mic: Pick<MicProfile, 'address'>): Msg => ({
  key: `engine.mic.address.${mic.address === 'end' || mic.address === 'side' ? mic.address : 'unknown'}`,
})

/** How to place the mic relative to the loudest noise source, from its pickup pattern (`engine.mic.placement.<cardioid|supercardioid|other>`). */
export const placementTip = (mic: Pick<MicProfile, 'pattern'>): Msg => ({
  key: `engine.mic.placement.${mic.pattern === 'cardioid' || mic.pattern === 'supercardioid' ? mic.pattern : 'other'}`,
})
