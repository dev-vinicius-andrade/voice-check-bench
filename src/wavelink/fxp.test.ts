import { describe, expect, it } from 'vitest'
import { COMP_PARAMS, GATE_PARAMS, a2db, b64decode, b64encode, db2a, decodeState, readBank, readEq, roundTrips, writeBank, writeEq } from './fxp'
import { TAIL, band, bankBlob, compValues, eqBlob, gateValues } from './testFixtures'

const bytesEq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, k) => v === b[k])

describe('base64', () => {
  it('round-trips every byte value and large blobs', () => {
    const all = Uint8Array.from({ length: 70000 }, (_, k) => k % 256)
    expect(bytesEq(b64decode(b64encode(all)), all)).toBe(true)
    expect(b64encode(Uint8Array.from([67, 99, 110, 75]))).toBe('Q2NuSw==')
  })
})

describe('FxBk banks (ReaGate / ReaComp)', () => {
  it('decodes the normalized parameters', () => {
    expect(decodeState('reagate', bankBlob(gateValues()))).toEqual({
      kind: 'reagate',
      threshold: expect.closeTo(-40, 4),
      attack: expect.closeTo(2, 4),
      release: expect.closeTo(300, 3),
      hold: expect.closeTo(100, 4),
      dry: -Infinity,
      wet: 0,
      hysteresis: expect.closeTo(-6, 4),
    })
    expect(decodeState('recomp', bankBlob(compValues()))).toEqual({
      kind: 'recomp',
      threshold: expect.closeTo(-20, 4),
      ratio: expect.closeTo(4, 4),
      attack: expect.closeTo(3, 4),
      release: expect.closeTo(80, 3),
      wet: expect.closeTo(2, 4),
      limit: false,
    })
  })

  it('re-encodes unchanged values byte-identically, also with bytes after the floats', () => {
    const blob = bankBlob(gateValues(), [1, 2, 3])
    expect(roundTrips('reagate', blob)).toBe(true)
    expect(bytesEq(writeBank(readBank(blob)), blob)).toBe(true)
  })

  it('re-packs only the changed indices when given the original', () => {
    const vals = gateValues()
    const blob = bankBlob(vals)
    new DataView(blob.buffer).setUint32(156 + 56 + 4 * 5, 0x7fc00001) // a NaN with a payload stays as it was
    const bank = readBank(blob)
    bank.vals[0] = db2a(-30)
    const out = writeBank(bank, blob, new Set([0]))
    expect(new DataView(out.buffer).getUint32(156 + 56 + 20)).toBe(0x7fc00001)
    expect(a2db(readBank(out).vals[0])).toBeCloseTo(-30, 4)
  })

  it('maps values both ways', () => {
    for (const m of [...GATE_PARAMS, ...COMP_PARAMS].filter((p) => p.key !== 'limit')) {
      const v = m.key === 'ratio' ? 3 : m.label.includes('dB') ? -12 : 150
      expect(m.toValue(m.fromValue(v))).toBeCloseTo(v, 9)
    }
  })

  it('rejects malformed blobs', () => {
    expect(() => readBank(new Uint8Array(10))).toThrow()
    expect(roundTrips('reagate', new Uint8Array(300))).toBe(false)
  })
})

describe('FBCh chunks (ReaEQ)', () => {
  it('decodes bands and keeps the tail', () => {
    const blob = eqBlob([band(0, 150, -4, 2), band(8, 3000, 2, 1, 0)])
    const c = readEq(blob)
    expect(c.ver).toBe(33)
    expect([...c.tail]).toEqual(TAIL)
    expect(decodeState('reaeq', blob)).toEqual({
      kind: 'reaeq',
      bands: [
        { type: 'Low Shelf', enabled: true, freq: 150, gain: expect.closeTo(-4, 9), bw: 2 },
        { type: 'Band', enabled: false, freq: 3000, gain: expect.closeTo(2, 9), bw: 1 },
      ],
    })
    expect(roundTrips('reaeq', blob)).toBe(true)
  })

  it('keeps FXP byteSize 0, updates it when it was set', () => {
    const zero = writeEq({ ...readEq(eqBlob([band(8, 1000, 0, 1)])), bands: [band(8, 1000, 0, 1), band(1, 9000, 1, 2)] })
    expect(new DataView(zero.buffer).getInt32(4)).toBe(0)
    const set = writeEq({ ...readEq(eqBlob([band(8, 1000, 0, 1)], 1)), bands: [band(8, 1000, 0, 1), band(1, 9000, 1, 2)] })
    expect(new DataView(set.buffer).getInt32(4)).toBe(set.length - 8)
    expect(new DataView(set.buffer).getInt32(156)).toBe(8 + 2 * 33 + 20)
    expect(readEq(set).bands).toHaveLength(2)
  })

  it('maps unknown band types to Other', () => {
    expect(decodeState('reaeq', eqBlob([band(4, 500, 0, 1)]))).toMatchObject({ bands: [{ type: 'Other' }] })
  })
})
