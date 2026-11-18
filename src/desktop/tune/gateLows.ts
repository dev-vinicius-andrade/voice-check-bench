// The gate ignoring low sounds (SPEC "Cut the noise"): bumps and muffled voices under the voice's own range must not
// open it. Framework-free.
// CONTRACT: the signature and its meaning are fixed.
import type { ChainSlot } from '../advice/types'

/** The detector's high-pass that makes a ReaGate ignore low sounds, Hz. */
export const GATE_IGNORE_LOWS_HZ = 300

/**
 * The value changes (slot, key, to) that make the chain's switched-on gates decide on the sound above
 * GATE_IGNORE_LOWS_HZ only (ReaGate's detector high-pass; the audio itself is not filtered). Empty when the chain has
 * no switched-on ReaGate, the value is already there or higher, or the adapter cannot set it.
 */
export function gateLowsEdits(chain: readonly ChainSlot[]): { slot: number; key: string; to: number }[] {
  // Measured on a real take and the real ReaGate (render session): its detector high-pass is VST parameter 6
  // "Hipass" (Hz = normalized × 20000) and it does act on the detector only, but on that chain the bursts still open
  // the gate at every setting tried (200–400 Hz): the gate's threshold sits 15 dB or more under what is left of them
  // after the filter, and the gate passes its dry signal at full level. So the adapter carries no such value and no
  // edit is proposed.
  void chain
  return []
}
