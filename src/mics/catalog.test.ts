import { describe, expect, it } from 'vitest'
import { DEFAULT_MIC, MIC_CATALOG, addressTip, findMic, placementTip } from './catalog'

describe('mic catalog', () => {
  it('lists the 14 known models with unique names', () => {
    expect(MIC_CATALOG).toHaveLength(14)
    expect(new Set(MIC_CATALOG.map((m) => m.model)).size).toBe(14)
  })

  it('finds models ignoring case and extra spaces', () => {
    expect(findMic('  shure   sm7b ')).toMatchObject({ kind: 'dynamic', pattern: 'cardioid', address: 'end' })
    expect(findMic('Blue Yeti')).toMatchObject({ kind: 'condenser', address: 'side' })
    expect(findMic('Fifine K669')?.kind).toBe('condenser')
    expect(findMic('')).toBeUndefined()
    expect(findMic('My own mic')).toBeUndefined()
  })

  it('gives address tips per address', () => {
    expect(addressTip({ address: 'end' })).toMatch(/top of the mic/)
    expect(addressTip({ address: 'side' })).toMatch(/front side/)
    expect(addressTip(DEFAULT_MIC)).toBe('Point the capsule at your mouth.')
  })

  it('gives placement tips per pattern', () => {
    expect(placementTip({ pattern: 'cardioid' })).toMatch(/back of the mic/)
    expect(placementTip({ pattern: 'supercardioid' })).toMatch(/125°/)
    for (const pattern of ['omni', 'figure8', 'unknown'] as const)
      expect(placementTip({ pattern })).toMatch(/won't reject it/)
  })
})
