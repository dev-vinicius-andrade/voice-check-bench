import { describe, expect, it } from 'vitest'
import { burstsIn, heardPausesDb, pausesSilent, quietLevels, type CalFrameLevels } from './levels'

const frames = (proc: readonly number[]): CalFrameLevels[] => proc.map((procDb) => ({ rawDb: -37, rawPeakDb: -27, procDb, procPeakDb: procDb + 10 }))
const silence = (n: number): number[] => new Array<number>(n).fill(-100)

describe('quiet pauses as heard', () => {
  it('digital silence is silent', () => {
    const q = quietLevels(frames(silence(30)))
    expect(pausesSilent(q)).toBe(true)
    expect(burstsIn(q)).toBe(false)
  })

  it('silent by the median, but the room coming through for a moment: bursts, not silent, heard at the burst', () => {
    const q = quietLevels(frames([...silence(26), -42, -40, -45, -100]))
    expect(q.pausesDb).toBe(-100)
    expect(burstsIn(q)).toBe(true)
    expect(pausesSilent(q)).toBe(false)
    expect(heardPausesDb(q)).toBe(-42)
  })

  it('one click is no burst', () => {
    expect(pausesSilent(quietLevels(frames([...silence(29), -40])))).toBe(true)
  })

  it('a steady quiet residual is silent; a steady room is not, and has no bursts either', () => {
    expect(pausesSilent(quietLevels(frames(new Array<number>(30).fill(-70).map((v, i) => v + (i % 3)))))).toBe(true)
    const room = quietLevels(frames(new Array<number>(30).fill(-38).map((v, i) => v + (i % 4))))
    expect(burstsIn(room)).toBe(false)
    expect(pausesSilent(room)).toBe(false)
    expect(heardPausesDb(room)).toBe(room.pausesDb)
  })

  it('bursts under the silent line are not heard', () => {
    expect(pausesSilent(quietLevels(frames([...silence(26), -70, -68, -72, -100])))).toBe(true)
  })
})
