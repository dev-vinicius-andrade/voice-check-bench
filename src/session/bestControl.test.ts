// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { fakeAnalysis } from '../audio/testSignals'
import { DEFAULT_GOAL, type Analysis, type AnalysisResult, type StepKey, type Take } from '../types'
import { realSession } from '../plain/testFixtures'
import { bestControl, controlScore, sessionSlots } from './bestControl'
import { distanceMismatch } from './distance'
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

  it('penalises low SNR by (40 - snr) / 2 when every control take has SNR >= 25', () => {
    // boomy score: boom dev 10 - 10/7, the other three 10/7 each => 10 + 20/7 ~ 12.9
    // ref at SNR 25: (40 - 25) / 2 = 7.5 < 12.9; at SNR 25 the doubled penalty (15) would lose
    const slots = [mkTake(1, 'c2', fakeAnalysis({ rel: boomy })), mkTake(2, 'c8', fakeAnalysis({ rel: ref, snr: 25 })), null, null]
    expect(bestControl(slots)?.take.id).toBe(2)
  })

  it('lets SNR dominate when any control take has SNR < 25: 0.5 x tone + 1.5 x (40 - snr)', () => {
    // ref at SNR 20: 1.5 x 20 = 30 > boomy's 0.5 x 12.9 (it would win with the quiet-room penalty of 10)
    const slots = [mkTake(1, 'c2', fakeAnalysis({ rel: boomy })), mkTake(2, 'c8', fakeAnalysis({ rel: ref, snr: 20 })), null, null]
    expect(bestControl(slots)?.take.id).toBe(1)
    // another noisy control take switches the weighting for all: ref at SNR 25 now scores 22.5 > boomy's 6.4
    const three = [mkTake(1, 'c2', fakeAnalysis({ rel: boomy })), mkTake(2, 'c8', fakeAnalysis({ rel: ref, snr: 25 })), mkTake(3, 'c15', fakeAnalysis({ rel: ref, snr: 10 })), null]
    expect(bestControl(three)?.take.id).toBe(1)
    // a noisy fx take does not switch the weighting
    const quiet = [mkTake(1, 'c2', fakeAnalysis({ rel: boomy })), mkTake(2, 'c8', fakeAnalysis({ rel: ref, snr: 26 })), null, mkTake(4, 'fx', fakeAnalysis({ snr: 5 }))]
    expect(bestControl(quiet)?.take.id).toBe(2)
  })

  it('picks 2 cm in the real noisy session (boomy but 8 dB over the room; 15 cm is buried at SNR 7.9)', () => {
    const { c2, c8, c15, fx } = realSession()
    const slots = [c2, c8, c15, fx]
    expect(bestControl(slots)).toEqual({ dist: '2 cm', cm: 2, take: c2 })
    const an = (t: Take): Analysis => t.analysis as Analysis
    const scores = [c2, c8, c15].map((t) => controlScore(an(t), true, DEFAULT_GOAL))
    expect(scores[0]).toBeCloseTo(49.4, 1)
    expect(scores[1]).toBeCloseTo(53.7, 1)
    expect(scores[2]).toBeCloseTo(56.4, 1)
    // the old noisy weighting (tone + (40 - snr)) picked 15 cm
    const old = [c2, c8, c15].map((t) => controlScore(an(t), false, DEFAULT_GOAL) + Math.max(0, 40 - an(t).snr) / 2)
    expect(old.indexOf(Math.min(...old))).toBe(2)
    // a quiet room keeps the prototype weighting
    const quiet = slots.map((t) => ({ ...t, analysis: { ...an(t), snr: an(t).snr + 30 } }))
    expect(bestControl(quiet)?.dist).toBe('15 cm')
  })
})

describe('distanceMismatch', () => {
  const { c2, c15, fx, applied } = realSession()
  it('flags a processed take recorded at another distance than the settings were made for', () => {
    expect(distanceMismatch(fx, c2)).toEqual({ expected: '2 cm', actual: '15 cm', msg: { key: 'plain.refine.wrongDistance', params: { dist: '2 cm', actual: '15 cm' } } })
    expect(distanceMismatch(fx, { ...applied, dist: '8 cm' })?.expected).toBe('8 cm')
    expect(distanceMismatch(fx, '2 cm')?.actual).toBe('15 cm')
  })
  it('is null when the distances match or one is unknown', () => {
    expect(distanceMismatch(fx, applied)).toBeNull()
    expect(distanceMismatch(fx, c15)).toBeNull()
    expect(distanceMismatch(fx, ' 15  CM ')).toBeNull()
    expect(distanceMismatch({ step: null, name: 'Free take' }, c2)).toBeNull()
    expect(distanceMismatch({ step: 'fx', name: 'renamed' }, c2)).toBeNull()
    expect(distanceMismatch(fx, null)).toBeNull()
    expect(distanceMismatch(fx, '')).toBeNull()
  })
})

describe('steps', () => {
  it('has the 4 wizard steps', () => {
    expect(STEPS.map((s) => s.key)).toEqual(['c2', 'c8', 'c15', 'fx'])
    expect(STEPS.map((s) => s.dev)).toEqual(['raw', 'raw', 'raw', 'fx'])
  })

  it('leads are generic (no mic model names)', () => {
    for (const s of STEPS) expect(`${s.title} ${s.head} ${s.lead}`).not.toMatch(/K688|Fifine|top of the/)
    expect(STEPS[0].lead).toBe('Mouth about 2 cm from the mic, speaking on-axis (straight into the capsule). This shows how much bass the mic adds up close.')
  })

  it('fills the distance placeholder', () => {
    expect(fillDistance(STEPS[3].title, '8 cm')).toBe('Processed · 8 cm · Record Mix')
    expect(fillDistance(STEPS[3].lead, '2 cm')).toContain('same distance as your best take: 2 cm.')
  })

  it('matches device labels', () => {
    expect(DEV_MATCH.raw('Microphone (Elgato Wave:XLR)')).toBe(true)
    expect(DEV_MATCH.raw('Mic In (Elgato Wave:XLR)')).toBe(true)
    expect(DEV_MATCH.raw('Elgato Virtual Audio (Mic In)')).toBe(false)
    expect(DEV_MATCH.fx('Elgato Virtual Audio (Record Mix)')).toBe(true)
    expect(DEV_MATCH.fx('Realtek Microphone')).toBe(false)
  })
})
