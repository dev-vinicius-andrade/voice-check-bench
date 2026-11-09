import { describe, expect, it } from 'vitest'
import { distanceCm, everydayDistance } from './distances'
import { GLOSSARY, glossaryEntry } from './glossary'

describe('everydayDistance', () => {
  it('maps the guided distances to everyday comparisons', () => {
    expect(everydayDistance('2 cm')).toEqual({ key: 'plain.distance.finger' })
    expect(everydayDistance('8 cm')).toEqual({ key: 'plain.distance.fist' })
    expect(everydayDistance('15 cm')).toEqual({ key: 'plain.distance.hand' })
    expect(everydayDistance('30 cm')).toEqual({ key: 'plain.distance.other', params: { dist: '30 cm' } })
  })

  it('parses centimetres', () => {
    expect([distanceCm('8 cm'), distanceCm(' 15cm '), distanceCm('2.5 cm'), distanceCm(null), distanceCm('far')]).toEqual([8, 15, 2.5, null, null])
  })
})

describe('glossary', () => {
  it('has term, meaning and analogy keys for each id', () => {
    expect(GLOSSARY).toHaveLength(11)
    expect(glossaryEntry('snr')).toEqual({
      id: 'snr',
      term: { key: 'plain.glossary.snr.term' },
      meaning: { key: 'plain.glossary.snr.meaning' },
      analogy: { key: 'plain.glossary.snr.analogy' },
    })
  })
})
