// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { fakeAnalysis } from '../audio/testSignals'
import type { AnalysisResult, StepKey, Take } from '../types'
import { bestControl, sessionSlots } from './bestControl'
import { DEV_MATCH, STEPS, fillDistance } from './steps'

const mkTake = (id: number, step: StepKey | null, analysis: AnalysisResult = fakeAnalysis(), session = 's1'): Take => ({
  id, name: `T${id}`, session, step, device: 'Mic', sampleRate: 48000, samples: new Float32Array(0), created: '', analysis,
})
const ref = [-18, -4, -1, 2, 0, -6, -7, -11, -17]
const boomy = [-18, 6, -1, 2, 0, -6, -7, -11, -17]

describe('sessionSlots', () => {
  it('takes the latest take per step of that session, in STEPS order', () => {
    const takes = [mkTake(1, 'c8'), mkTake(5, 'c8'), mkTake(3, 'c2'), mkTake(9, 'c2', fakeAnalysis(), 's2'), mkTake(4, 'fx'), mkTake(7, null, fakeAnalysis(), 'free')]
    expect(sessionSlots(takes, 's1').map((t) => t?.id ?? null)).toEqual([3, 5, null, 4])
  })
})

describe('bestControl', () => {
  it('needs at least two analyzed control takes', () => {
    expect(bestControl([mkTake(1, 'c2'), null, mkTake(2, 'c15', { error: 'x' }), mkTake(3, 'fx')])).toBeNull()
  })

  it('picks the lowest boom/warmth/mud/body deviation and ignores the fx slot', () => {
    const slots = [mkTake(1, 'c2', fakeAnalysis({ rel: boomy })), mkTake(2, 'c8', fakeAnalysis({ rel: ref })), mkTake(3, 'c15', fakeAnalysis({ rel: boomy })), mkTake(4, 'fx', fakeAnalysis({ rel: ref, snr: 80 }))]
    expect(bestControl(slots)).toEqual({ dist: '8 cm', cm: 8, take: slots[1] })
  })

  it('penalises low SNR by (40 - snr) / 2', () => {
    // boomy score: boom dev 10 - 10/7, the other three 10/7 each => 10 + 20/7 ~ 12.9
    const slots = [mkTake(1, 'c2', fakeAnalysis({ rel: boomy })), mkTake(2, 'c8', fakeAnalysis({ rel: ref, snr: 10 })), null, null]
    expect(bestControl(slots)?.take.id).toBe(1)
    slots[1] = mkTake(2, 'c8', fakeAnalysis({ rel: ref, snr: 20 }))
    expect(bestControl(slots)?.take.id).toBe(2)
  })
})

describe('steps', () => {
  it('has the 4 wizard steps', () => {
    expect(STEPS.map((s) => s.key)).toEqual(['c2', 'c8', 'c15', 'fx'])
    expect(STEPS.map((s) => s.dev)).toEqual(['raw', 'raw', 'raw', 'fx'])
  })

  it('fills the distance placeholder', () => {
    expect(fillDistance(STEPS[3].title, '8 cm')).toBe('Processed · 8 cm · Record Mix')
    expect(fillDistance(STEPS[3].lead, '2 cm')).toContain('best distance: 2 cm.')
  })

  it('matches device labels', () => {
    expect(DEV_MATCH.raw('Microphone (Elgato Wave:XLR)')).toBe(true)
    expect(DEV_MATCH.raw('Mic In (Elgato Wave:XLR)')).toBe(true)
    expect(DEV_MATCH.raw('Elgato Virtual Audio (Mic In)')).toBe(false)
    expect(DEV_MATCH.fx('Elgato Virtual Audio (Record Mix)')).toBe(true)
    expect(DEV_MATCH.fx('Realtek Microphone')).toBe(false)
  })
})
