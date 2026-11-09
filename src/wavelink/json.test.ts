import { describe, expect, it } from 'vitest'
import { detectFormat, dotnetString, dumpTree, parseTree, prop, setProp } from './json'
import { settingsText } from './testFixtures'

const roundTrip = (text: string) => dumpTree(parseTree(text), detectFormat(text))

describe('lossless JSON tree', () => {
  it('re-serializes Wave Link formatting byte-identically (CRLF, 2 spaces, .NET escaping, int-like keys)', () => {
    const text = settingsText()
    expect(detectFormat(text)).toEqual({ nl: '\r\n', indent: '  ', dotnet: true, trailingNl: false, bom: false })
    expect(roundTrip(text)).toBe(text)
  })

  it('keeps a BOM and a trailing newline', () => {
    const text = '\uFEFF' + settingsText() + '\r\n'
    expect(detectFormat(text)).toMatchObject({ bom: true, trailingNl: true })
    expect(roundTrip(text)).toBe(text)
  })

  it('keeps number literals and key order as written', () => {
    const text = '{\n    "b": 1.0,\n    "2": 1E-05,\n    "a": [\n        -0.5,\n        {}\n    ]\n}\n'
    expect(roundTrip(text)).toBe(text)
  })

  it('writes Python-style plain JSON without .NET escaping', () => {
    const text = '{\n  "name": "Café \\"x\\"",\n  "list": [\n    1,\n    true,\n    null\n  ]\n}'
    expect(detectFormat(text).dotnet).toBe(false)
    expect(roundTrip(text)).toBe(text)
    expect(roundTrip('{"a": [1, 2], "b": {}}')).toBe('{"a": [1, 2], "b": {}}')
  })

  it('escapes strings like System.Text.Json', () => {
    expect(dotnetString('a"b+c<>&\'`\\\n é 😀')).toBe('"a\\u0022b\\u002Bc\\u003C\\u003E\\u0026\\u0027\\u0060\\\\\\n \\u00E9 \\uD83D\\uDE00"')
  })

  it('rejects invalid JSON', () => {
    for (const bad of ['', '{', '{"a":}', '[1,]', '{"a":1} x', '"\u0001"', 'NaN']) expect(() => parseTree(bad)).toThrow(SyntaxError)
  })

  it('reads and sets properties', () => {
    const tree = parseTree('{"a":1,"a":2}')
    expect(prop(tree, 'a')).toEqual({ t: 'num', raw: '2' })
    setProp(tree, 'b', { t: 'bool', v: true })
    expect(dumpTree(tree, detectFormat('{}'))).toBe('{"a": 1, "a": 2, "b": true}')
  })
})
