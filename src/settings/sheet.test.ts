// The exported settings sheet and JSON stay byte-identical English after the move to message keys
// (golden files captured from the pre-i18n code), and "Copy as text" can produce a localized sheet.
import { describe, expect, it } from 'vitest'
import i18n from '../i18n'
import type { Msg } from '../plain/types'
import golden from './golden/sheets.json'
import { SHEET_FIXTURES } from './sheetFixtures'
import { englishText } from './english'
import { suggest, suggestionToJson, suggestionToText } from './suggest'

const GOLDEN = golden as Record<string, { text: string; json: string }>
const translator = (lng: string) => {
  const t = i18n.getFixedT(lng)
  return (m: Msg): string => t(m.key, m.params ?? {})
}
const suggestionOf = (name: string) => {
  const [take, dist] = SHEET_FIXTURES[name]
  const s = suggest(take, dist)
  if (!s) throw new Error(`no suggestion for ${name}`)
  return s
}

describe('settings sheet export', () => {
  it('has a golden file per fixture', () => {
    expect(Object.keys(GOLDEN).sort()).toEqual(Object.keys(SHEET_FIXTURES).sort())
  })

  for (const name of Object.keys(SHEET_FIXTURES)) {
    it(`${name}: text without a translator and JSON are byte-identical to before`, () => {
      const s = suggestionOf(name)
      expect(suggestionToText(s)).toBe(GOLDEN[name].text)
      expect(suggestionToText(s, englishText)).toBe(GOLDEN[name].text)
      expect(JSON.stringify(suggestionToJson(s), null, 2)).toBe(GOLDEN[name].json)
    })

    it(`${name}: i18next in English renders the same sheet`, () => {
      expect(suggestionToText(suggestionOf(name), translator('en'))).toBe(GOLDEN[name].text)
    })
  }

  it('localizes the copied sheet, keeping plugin and parameter names', () => {
    const s = suggestionOf('noisyCondenserSide')
    const pt = suggestionToText(s, translator('pt-BR'), 'Um punho de distância · 8 cm')
    expect(pt.split('\n')[0]).toBe('Voice Check Bench · configurações sugeridas')
    expect(pt).toContain('Com base em: Um punho de distância · 8 cm (fala -22,0 dBFS, ruído -40 dBFS)')
    expect(pt).toContain('PRIMEIRO: A entrada está ruidosa')
    expect(pt).toContain('Ordem dos efeitos: ReaFIR → ReaEQ → ReaComp → ReaGate')
    expect(pt).toContain('  Band 1: Type High Shelf · Frequency 10000 Hz · Gain -2,0 dB · Bandwidth 2,00 oct   (O ruído do ambiente domina acima de 5 kHz)')
    expect(pt).toMatch(/Type Band \(corte estreito\) · Frequency 6200 Hz · Gain -12,0 dB · Bandwidth 0,10 oct {3}\(Tom de ventilador\/máquina \+30,0 dB\)/)
    expect(pt).toContain('  Threshold: -44 dB')
    expect(pt).not.toMatch(/engine\./)
  })
})
