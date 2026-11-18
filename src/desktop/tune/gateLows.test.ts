// @vitest-environment node
// The gate ignoring low sounds: no edit while the adapter cannot set ReaGate's detector high-pass (gateLows.ts).
import { describe, expect, it } from 'vitest'
import { comp, gate } from '../advice/testFixtures'
import { gateLowsEdits, GATE_IGNORE_LOWS_HZ } from './gateLows'

describe('gateLowsEdits', () => {
  it('is empty without a gate', () => {
    expect(gateLowsEdits([comp(4)])).toEqual([])
    expect(gateLowsEdits([])).toEqual([])
  })

  it('is empty for a switched-on ReaGate: the adapter has no detector high-pass value', () => {
    expect(GATE_IGNORE_LOWS_HZ).toBe(300)
    expect(gateLowsEdits([gate({ thresholdDb: -58 }), comp(4)])).toEqual([])
  })
})
