// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { measure, prepareTake, type TakeMask } from './measure'
import { scoreOf } from './score'
import { COMP_BURST_OK_DB } from './stages'
import { targetsOf } from './targets'
import { testTake } from './testTake'
import type { TuneGoals } from './types'

const goals = (bothers: TuneGoals['bothers'] = []): TuneGoals => ({ use: 'streaming', style: 'natural', bothers, amount: 'medium' })
const take = testTake({ speechDb: -21, noiseDb: -45 })
const mask = prepareTake(take) as TakeMask
if (!mask) throw new Error('test take not analysable')
/** A render with silent pauses and one burst `under` dB under the voice. */
const withBurst = (under: number) => ({ ...measure(mask, take), snrDb: 80, burstDb: under, burstEvents: 2 })

describe('uneven volume: an even level before the last dB of the bursts', () => {
  it('only "uneven volume" without "noise comes and goes" puts the even level first', () => {
    expect(targetsOf(goals()).evenFirst).toBe(false)
    expect(targetsOf(goals(['unevenVolume'])).evenFirst).toBe(true)
    expect(targetsOf(goals(['unevenVolume', 'noisePumps'])).evenFirst).toBe(false)
    expect(targetsOf(goals(['unevenVolume', 'flat'])).evenFirst).toBe(false)
  })

  it('judged with a burst target of its own, bursts further under the voice than it cost nothing; nearer ones cost by that target', () => {
    const t = targetsOf(goals(['unevenVolume']))
    expect(t.snrDb).toBeGreaterThan(COMP_BURST_OK_DB)
    const judge = { ...t, burstSnrDb: COMP_BURST_OK_DB }
    expect(scoreOf(withBurst(COMP_BURST_OK_DB + 1), t).noise).toBeGreaterThan(0)
    expect(scoreOf(withBurst(COMP_BURST_OK_DB + 1), judge).noise).toBe(0)
    const near = scoreOf(withBurst(COMP_BURST_OK_DB - 4), judge).noise
    expect(near).toBeGreaterThan(0)
    expect(near).toBeLessThan(scoreOf(withBurst(COMP_BURST_OK_DB - 4), t).noise)
  })

  it('the steady room in the pauses is still held to the full target', () => {
    const t = targetsOf(goals(['unevenVolume']))
    const noisy = { ...measure(mask, take), snrDb: COMP_BURST_OK_DB + 1, burstDb: NaN, burstEvents: 0 }
    expect(scoreOf(noisy, { ...t, burstSnrDb: COMP_BURST_OK_DB }).noise).toBe(scoreOf(noisy, t).noise)
  })
})
