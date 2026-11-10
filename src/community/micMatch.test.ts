import { describe, expect, it } from 'vitest'
import { levenshtein, matchMic, type KnownMic } from './micMatch'
import type { MicAliases } from './types'

const NONE: MicAliases = { aliases: {}, distinct: [] }
const known: KnownMic[] = [
  { key: 'fifinek688', model: 'Fifine K688', reports: 3 },
  { key: 'at2020usb', model: 'AT2020USB+', reports: 1 },
  { key: 'shuresm7b', model: 'Shure SM7B', reports: 2 },
  { key: 'shuresm57', model: 'Shure SM57', reports: 1 },
  { key: 'blueyeti', model: 'Blue Yeti', reports: 4 },
]

describe('levenshtein', () => {
  it('counts inserts, deletes and substitutions', () => {
    expect(levenshtein('', 'abc')).toBe(3)
    expect(levenshtein('kitten', 'sitting')).toBe(3)
    expect(levenshtein('fifinek688', 'fifinek688')).toBe(0)
    expect(levenshtein('blueyeti', 'blueyetti')).toBe(1)
  })
})

describe('matchMic', () => {
  it('returns an empty key for a model without letters or digits', () => {
    expect(matchMic('!!!', known, NONE).key).toBe('')
  })

  it('joins K688 spellings to fifinek688', () => {
    expect(matchMic('fifine k 688', known, NONE)).toEqual({ key: 'fifinek688', model: 'Fifine K688', how: 'exact' })
    for (const m of ['K-688', 'k688', 'Fifine K688 USB']) {
      expect(matchMic(m, known, NONE)).toEqual({ key: 'fifinek688', model: 'Fifine K688', how: 'fuzzy' })
    }
  })

  it('uses aliases first, even for a key that is not known yet', () => {
    const aliases: MicAliases = { aliases: { k688: 'fifinek688', yeticlassic: 'blueyetix' }, distinct: [] }
    expect(matchMic('K688', known, aliases)).toEqual({ key: 'fifinek688', model: 'Fifine K688', how: 'alias' })
    expect(matchMic('Yeti Classic', known, aliases)).toEqual({ key: 'blueyetix', model: 'Yeti Classic', how: 'alias' })
  })

  it('does not join keys shorter than the fuzzy minimum (SM7 vs SM7B)', () => {
    expect(matchMic('SM7', [{ key: 'sm7b', model: 'SM7B', reports: 5 }], NONE)).toEqual({ key: 'sm7', model: 'SM7', how: 'new' })
  })

  it('joins AT2020 to AT2020USB unless the pair is listed as distinct', () => {
    expect(matchMic('AT2020', known, NONE)).toMatchObject({ key: 'at2020usb', how: 'fuzzy' })
    const distinct: MicAliases = { aliases: {}, distinct: [['at2020usb', 'at2020']] }
    expect(matchMic('AT2020', known, distinct)).toEqual({ key: 'at2020', model: 'AT2020', how: 'new' })
  })

  it('never joins typos that differ in a digit (SM58 vs SM57)', () => {
    expect(levenshtein('shuresm58', 'shuresm57')).toBe(1)
    expect(matchMic('Shure SM58', known, NONE)).toEqual({ key: 'shuresm58', model: 'Shure SM58', how: 'new' })
    expect(matchMic('Fifine K668', known, NONE).how).toBe('new')
  })

  it('joins typos without digit changes (1 edit from 5 chars, 2 from 8)', () => {
    expect(matchMic('Blue Yetti', known, NONE)).toMatchObject({ key: 'blueyeti', how: 'fuzzy' })
    expect(matchMic('Bluu Yetti', known, NONE)).toMatchObject({ key: 'blueyeti', how: 'fuzzy' })
    expect(matchMic('Shure SM7', known, NONE)).toMatchObject({ key: 'shuresm7b', how: 'fuzzy' })
    expect(matchMic('Yeti', known, NONE).how).toBe('new')
  })

  it('picks the candidate with most reports, then the lowest key', () => {
    const k: KnownMic[] = [
      { key: 'rodent1b', model: 'b', reports: 1 },
      { key: 'rodent1a', model: 'a', reports: 1 },
      { key: 'rodent1c', model: 'c', reports: 2 },
    ]
    expect(matchMic('rode nt1', k, NONE).key).toBe('rodent1c')
    expect(matchMic('rode nt1', k.slice(0, 2), NONE).key).toBe('rodent1a')
  })
})
