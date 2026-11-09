// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { fakeAnalysis } from '../audio/testSignals'
import { mic, noisyAnalysis, processedPair } from '../plain/testFixtures'
import { applyPlan, micInputKey, parseSettings } from '../wavelink/codec'
import { b64encode } from '../wavelink/fxp'
import { bankBlob, compValues, settingsText, suggestionFixture } from '../wavelink/testFixtures'
import {
  canValidate,
  captureStates,
  duplicateProfile,
  exportProfile,
  importProfile,
  profileFromSession,
  profilePlan,
  sessionValidation,
  suggestProfileName,
} from './build'
import { PROFILE_MIN_GAIN, type Profile, type ProfileValidation } from './types'

const NOW = new Date('2026-11-09T12:00:00.000Z')
const goal = { style: 'warm' as const, perceived: ['boomy' as const] }

const draft = (over: Partial<Parameters<typeof profileFromSession>[0]> = {}): Profile =>
  profileFromSession({
    mic: mic(),
    host: 'wavelink',
    dist: '8 cm',
    goal,
    mains: 'auto',
    suggestion: suggestionFixture(),
    raw: null,
    fx: null,
    id: 'p1',
    now: NOW,
    ...over,
  })

describe('profileFromSession', () => {
  it('suggests "<host> · <style>" names', () => {
    expect(suggestProfileName('wavelink', 'warm')).toBe('Wave Link · Warm')
    expect(suggestProfileName('obs', 'clear', 'Clara')).toBe('OBS Studio · Clara')
    expect(suggestProfileName(null, 'natural')).toBe('Natural')
    expect(draft().name).toBe('Wave Link · Warm')
    expect(draft({ name: '  Desk mic ' }).name).toBe('Desk mic')
  })

  it('validates when processing beats raw by PROFILE_MIN_GAIN points without regressions', () => {
    const raw = noisyAnalysis()
    const fx = fakeAnalysis()
    const v = sessionValidation(raw, fx, goal, NOW)!
    expect(v.fxScore - v.rawScore).toBeGreaterThanOrEqual(PROFILE_MIN_GAIN)
    expect(v).toMatchObject({ regressions: [], snrGain: 48, date: NOW.toISOString() })
    const p = draft({ raw, fx })
    expect(p.validation).toEqual(v)
    expect(p).toMatchObject({ version: 1, id: 'p1', created: NOW.toISOString(), updated: NOW.toISOString(), host: 'wavelink' })
  })

  it('keeps a draft (validation null) with regressions, too little gain, or a missing take', () => {
    const { raw, fx } = processedPair()
    const v = sessionValidation(raw, fx, goal, NOW)!
    expect(v.regressions.length).toBeGreaterThan(0)
    expect(canValidate(v)).toBe(false)
    expect(draft({ raw, fx }).validation).toBeNull()
    expect(draft({ raw: fakeAnalysis() }).validation).toBeNull()
    expect(sessionValidation(null, fakeAnalysis(), goal)).toBeNull()
  })

  it('applies the rule at its edge', () => {
    const v = (rawScore: number, fxScore: number, regressions: string[] = []): ProfileValidation => ({ rawScore, fxScore, snrGain: 0, regressions, date: 'x' })
    expect(canValidate(v(60, 65))).toBe(true)
    expect(canValidate(v(60, 64))).toBe(false)
    expect(canValidate(v(60, 90, ['chopped']))).toBe(false)
    expect(canValidate(null)).toBe(false)
  })
})

describe('export / import', () => {
  const full = (): Profile => ({
    ...draft({ raw: noisyAnalysis(), fx: fakeAnalysis(), devices: { raw: 'USB Mic', fx: null } }),
    wavelinkStates: { ReaComp: b64encode(bankBlob(compValues())), ReaFIR: b64encode(bankBlob([1, 2])) },
  })

  it('round-trips a profile; the active flag is local and not exported', () => {
    const p = { ...full(), active: true }
    const text = exportProfile(p)
    expect(JSON.parse(text)).not.toHaveProperty('active')
    const { active: _a, ...rest } = p
    void _a
    expect(importProfile(text)).toEqual(rest)
  })

  it('keeps non-finite levels as null → NaN', () => {
    const p = draft({ suggestion: suggestionFixture({ speechDbfs: Number.NaN }) })
    expect(importProfile(exportProfile(p))?.suggestion.speechDbfs).toBeNaN()
  })

  it('drops unknown keys everywhere', () => {
    const o = JSON.parse(exportProfile(full()))
    o.extra = 'x'
    o.mic.extra = 1
    o.suggestion.gate.extra = 1
    o.suggestion.eq[0].onclick = 'x'
    const p = importProfile(JSON.stringify(o))!
    expect(p).not.toHaveProperty('extra')
    expect(p.mic).not.toHaveProperty('extra')
    expect(p.suggestion.gate).not.toHaveProperty('extra')
    expect(p.suggestion.eq[0]).not.toHaveProperty('onclick')
  })

  it('rejects malformed files', () => {
    const p = full()
    const DEL = Symbol('delete')
    /** Sets (or deletes) the value at a dotted path of the exported JSON. */
    const mutated = (path: string, value: unknown): string => {
      const o = JSON.parse(exportProfile(p)) as Record<string, unknown>
      const keys = path.split('.')
      const parent = keys.slice(0, -1).reduce<Record<string, unknown>>((n, k) => n[k] as Record<string, unknown>, o)
      const last = keys[keys.length - 1]
      if (value === DEL) delete parent[last]
      else parent[last] = value
      return JSON.stringify(o)
    }
    const bad: [string, unknown][] = [
      ['version', 2],
      ['id', DEL],
      ['id', 'a b<script>'],
      ['name', '   '],
      ['created', 'yesterday'],
      ['host', 'winamp'],
      ['mains', 55],
      ['goal.style', 'loud'],
      ['goal.perceived', ['nasal', 'weird']],
      ['mic.kind', 'laser'],
      ['suggestion.comp', DEL],
      ['suggestion.gate.threshold', 5], // outside the Python tool's range
      ['suggestion.eq.0.type', 'Notch'],
      ['suggestion.eq', Array(13).fill(p.suggestion.eq[0])],
      ['suggestion.chain', 'ReaGate'],
      ['validation.fxScore', 101],
      ['validation.regressions', ['louder']],
      ['wavelinkStates', { 'Elgato EQ': p.wavelinkStates!.ReaComp }],
      ['wavelinkStates.ReaComp', 'not base64!'],
      ['wavelinkStates.ReaComp', 'AAAA'], // not an FXP blob
      ['wavelinkStates.ReaComp', 'Q2NuSwAAAAA='], // FXP magic but does not decode
      ['devices', { raw: 1, fx: null }],
    ]
    for (const [path, value] of bad) expect(importProfile(mutated(path, value)), path).toBeNull()
    expect(importProfile(mutated('name', 'ok'))).not.toBeNull()
    expect(importProfile('not json')).toBeNull()
    expect(importProfile('[]')).toBeNull()
    expect(importProfile('x'.repeat(1_000_001))).toBeNull()
  })

  it('duplicates under a new id and name, not active', () => {
    const p = { ...full(), active: true }
    const d = duplicateProfile(p, 'Copy', NOW)
    expect(d.id).not.toBe(p.id)
    expect(d).toMatchObject({ name: 'Copy', created: NOW.toISOString() })
    expect(d).not.toHaveProperty('active')
  })
})

describe('Wave Link plan of a profile', () => {
  it('captures the ReaPlugs states of the input and restores them over the suggestion', () => {
    const file = parseSettings(settingsText())
    const key = micInputKey(file)!
    const states = captureStates(file, key)
    expect(Object.keys(states).sort()).toEqual(['ReaComp', 'ReaEQ', 'ReaGate'])
    expect(captureStates(file, 'nope')).toEqual({})

    const comp = compValues()
    comp[0] = 0.5
    const p = draft({ wavelinkStates: { ...states, ReaComp: b64encode(bankBlob(comp)) } })
    const plan = profilePlan(p, file)
    expect(plan).toEqual({ inputKey: key, suggestion: p.suggestion, restoreStates: p.wavelinkStates })
    const r = applyPlan(file, plan)
    const after = parseSettings(r.text).inputs[0].plugins
    expect(after.find((x) => x.name.startsWith('ReaComp'))!.parameterState).toBe(p.wavelinkStates!.ReaComp)
    // restored gate/EQ equal the originals: the suggestion values are overridden by the exact states
    expect(after.find((x) => x.name.startsWith('ReaGate'))!.parameterState).toBe(states.ReaGate)
    expect(r.changes).toEqual([{ plugin: 'ReaComp', kind: 'value', field: 'Threshold (dB)', from: '-20', to: '-6' }])
  })

  it('without states the plan is the suggestion only', () => {
    const file = parseSettings(settingsText())
    expect(profilePlan(draft(), file, 'x')).toEqual({ inputKey: 'x', suggestion: draft().suggestion })
  })
})

interface NodeFs {
  existsSync(p: URL): boolean
  readFileSync(p: URL, enc: 'utf8'): string
}
const fsModule = 'node:fs'
const fs = (await import(/* @vite-ignore */ fsModule)) as NodeFs
const realUrl = new URL('../../_test/wavelink-settings.json', import.meta.url)

describe.skipIf(!fs.existsSync(realUrl))('captureStates on the real Wave Link file', () => {
  it('captures ReaFIR, ReaGate, ReaEQ and ReaComp of the mic input, and restoring them changes nothing', () => {
    const file = parseSettings(fs.readFileSync(realUrl, 'utf8'))
    const key = micInputKey(file)!
    const states = captureStates(file, key)
    expect(Object.keys(states).sort()).toEqual(['ReaComp', 'ReaEQ', 'ReaFIR', 'ReaGate'])
    expect(states.ReaFIR.length).toBeGreaterThan(1000)
    const p = draft({ wavelinkStates: states })
    expect(importProfile(exportProfile(p))?.wavelinkStates).toEqual(states)
    expect(applyPlan(file, { inputKey: key, restoreStates: states })).toEqual({ text: file.text, changes: [], missing: [] })
  })
})
