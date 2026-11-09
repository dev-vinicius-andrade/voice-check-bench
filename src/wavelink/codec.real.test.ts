// @vitest-environment node
// Checks against the real Wave Link file (_test/wavelink-settings.json, local and git-ignored); skipped when absent.
// Read-only: nothing is ever written to that file.
import { describe, expect, it } from 'vitest'
import { applyPlan, micInputKey, parseSettings, serialize } from './codec'
import { b64decode, roundTrips } from './fxp'
import { parseTree } from './json'
import { cockosKind } from './plugins'
import { suggestionFixture } from './testFixtures'
import type { WlFile, WlPlugin, WlPluginState } from './types'

interface NodeFs {
  existsSync(p: URL): boolean
  readFileSync(p: URL): Uint8Array
}
const fsModule = 'node:fs'
const fs = (await import(/* @vite-ignore */ fsModule)) as NodeFs
const url = new URL('../../_test/wavelink-settings.json', import.meta.url)
const present = fs.existsSync(url)
const bytes = present ? fs.readFileSync(url) : new Uint8Array()
/** The text as the file holds it (a BOM, if any, kept as U+FEFF). */
const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, k) => v === b[k])

const find = (f: WlFile, name: string): WlPlugin => f.inputs[0].plugins.findLast((p) => p.name.startsWith(name))!
type Of<K extends WlPluginState['kind']> = Extract<WlPluginState, { kind: K }>
const round = (v: number, d = 1) => +v.toFixed(d)

describe.skipIf(!present)('real Wave Link Settings.json', () => {
  it('finds the PCM_IN mic input with ReaFIR, ReaGate, ReaEQ, ReaComp and the stored values', () => {
    const f = parseSettings(text)
    expect(micInputKey(f)).toContain('PCM_IN')
    const names = f.inputs[0].plugins.map((p) => p.name)
    for (const n of ['ReaFir', 'ReaGate', 'ReaEQ', 'ReaComp']) expect(names.some((x) => x.startsWith(n))).toBe(true)
    expect(find(f, 'ReaFir').state.kind).toBe('opaque')
    // values as stored on 2026-11-09 (same as `python tools/apply-reaplugs.py --show --settings _test/wavelink-settings.json`)
    const g = find(f, 'ReaGate').state as Of<'reagate'>
    expect([g.threshold, g.attack, g.hold, g.release, g.hysteresis, g.wet, g.dry].map((v) => round(v))).toEqual([-41, 1, 200, 300, -6, 0, 0])
    const c = find(f, 'ReaComp').state as Of<'recomp'>
    expect([c.threshold, c.ratio, c.attack, c.release, c.wet].map((v) => round(v))).toEqual([-33, 2.5, 5, 100, 2])
    expect(c.limit).toBe(true)
    const eq = find(f, 'ReaEQ').state as Of<'reaeq'>
    expect(eq.bands.map((b) => [b.type, Math.round(b.freq), round(b.gain), round(b.bw, 2), b.enabled])).toEqual([
      ['Low Shelf', 150, -5, 2, true],
      ['Band', 250, -3.5, 1.5, true],
      ['High Shelf', 10000, -2, 2, true],
      ['Band', 1617, -10, 0.1, true],
      ['Band', 768, -6.5, 0.1, true],
    ])
    expect(find(f, 'Elgato De-Esser').on).toBe(false)
  })

  it('round-trips the whole file byte-identically', () => {
    const f = parseSettings(text)
    expect(sameBytes(new TextEncoder().encode(serialize(f, parseTree(text))), bytes)).toBe(true)
    expect(applyPlan(f, { inputKey: micInputKey(f)! }).text).toBe(text)
  })

  it('re-encodes every unchanged ReaPlugs state byte-identically', () => {
    const f = parseSettings(text)
    const reaplugs = f.inputs.flatMap((i) => i.plugins).filter((p) => cockosKind(p.name))
    expect(reaplugs.length).toBeGreaterThanOrEqual(3)
    for (const p of reaplugs) expect(roundTrips(cockosKind(p.name)!, b64decode(p.parameterState))).toBe(true)
  })

  it('applies tools/example-settings.json values and reads them back; only ParameterState lines change', () => {
    const f = parseSettings(text)
    const r = applyPlan(f, { inputKey: micInputKey(f)!, suggestion: suggestionFixture() })
    const after = parseSettings(r.text)
    const g = find(after, 'ReaGate').state as Of<'reagate'>
    expect([g.threshold, g.attack, g.hold, g.release, g.hysteresis, g.wet, g.dry].map((v) => round(v))).toEqual([-60, 1, 150, 200, -6, 0, -20])
    const c = find(after, 'ReaComp').state as Of<'recomp'>
    expect([c.threshold, c.ratio, c.attack, c.release, c.wet, c.limit]).toEqual([
      expect.closeTo(-34, 4),
      expect.closeTo(3, 4),
      expect.closeTo(5, 4),
      expect.closeTo(100, 3),
      expect.closeTo(12, 4),
      true,
    ])
    const eq = find(after, 'ReaEQ').state as Of<'reaeq'>
    expect(eq.bands.map((b) => [b.type, b.freq, round(b.gain, 6), b.bw])).toEqual([
      ['Low Shelf', 150, -4, 2],
      ['Band', 1000, 3, 1.5],
      ['Band', 4000, 3, 1.4],
      ['High Shelf', 10000, 1, 2],
    ])
    const a = text.split('\r\n')
    const b = r.text.split('\r\n')
    expect(b).toHaveLength(a.length)
    const changed = b.filter((l, k) => l !== a[k])
    expect(changed).toHaveLength(3)
    expect(changed.every((l) => l.trimStart().startsWith('"ParameterState"'))).toBe(true)
    expect(r.missing).toEqual([])
  })
})
