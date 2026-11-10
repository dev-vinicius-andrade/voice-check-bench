// Strict parsing of profiles (imported files are untrusted; stored rows may be old or damaged). Framework-free.
// parseProfile rebuilds the object from known keys only, so unknown keys never get in (like src/community/validate.ts).
import type { SuggestionJson } from '../settings/suggest'
import type { DeviceChoice, EqBand, MicProfile, PerceivedIssue, VoiceGoal, VoiceStyle } from '../types'
import { b64decode, isFxp, roundTrips } from '../wavelink/fxp'
import { REAPLUGS, validateSuggestion } from '../wavelink/plugins'
import type { Profile, ProfileHost, ProfileValidation } from './types'

type Obj = Record<string, unknown>

const HOSTS: readonly NonNullable<ProfileHost>[] = ['wavelink', 'obs', 'apps', 'nvidia']
const MIC_KINDS: readonly MicProfile['kind'][] = ['dynamic', 'condenser', 'unknown']
const MIC_PATTERNS: readonly MicProfile['pattern'][] = ['cardioid', 'supercardioid', 'omni', 'figure8', 'unknown']
const MIC_ADDRESSES: readonly MicProfile['address'][] = ['end', 'side', 'unknown']
const STYLES: readonly VoiceStyle[] = ['natural', 'warm', 'clear', 'bright']
const PERCEIVED: readonly PerceivedIssue[] = ['nasal', 'muffled', 'boomy', 'thin', 'harsh', 'sharpS', 'dull']
const EQ_TYPES: readonly EqBand['type'][] = ['Low Shelf', 'Band', 'High Shelf']
const REGRESSIONS = ['quieter', 'thin', 'harsh', 'chopped'] as const

export const MAX_PROFILE_TEXT = 1_000_000
const MAX_NAME = 120
const MAX_TEXT = 2000
const MAX_LIST = 20
const MAX_EQ = 12
const MAX_STATE = 200_000
const B64 = /^[A-Za-z0-9+/]*={0,2}$/

class Invalid extends Error {}
const fail = (what: string): never => {
  throw new Invalid(what)
}
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const obj = (v: unknown, what: string): Obj => (isObj(v) ? v : fail(what))
const num = (v: unknown, lo: number, hi: number, what: string): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : fail(what)
/** JSON null (non-finite numbers are exported as null) or NaN (stored rows) → NaN. */
const numOrNull = (v: unknown, lo: number, hi: number, what: string): number =>
  v === null || Number.isNaN(v) ? Number.NaN : num(v, lo, hi, what)
const oneOf = <T extends string | number>(v: unknown, allowed: readonly T[], what: string): T =>
  allowed.includes(v as T) ? (v as T) : fail(what)
const str = (v: unknown, what: string, max = MAX_TEXT): string => (typeof v === 'string' && v.length <= max ? v : fail(what))
const strOrNull = (v: unknown, what: string): string | null => (v === null ? null : str(v, what))
const bool = (v: unknown, what: string): boolean => (typeof v === 'boolean' ? v : fail(what))
const arr = (v: unknown, max: number, what: string): unknown[] => (Array.isArray(v) && v.length <= max ? v : fail(what))
const strList = (v: unknown, what: string, max = MAX_TEXT): string[] => arr(v, MAX_LIST, what).map((s) => str(s, what, max))
const date = (v: unknown, what: string): string => {
  const s = str(v, what, 40)
  return Number.isFinite(Date.parse(s)) ? s : fail(what)
}

function parseMic(v: unknown): MicProfile {
  const m = obj(v, 'mic')
  return {
    model: str(m.model, 'mic.model', 80),
    kind: oneOf(m.kind, MIC_KINDS, 'mic.kind'),
    pattern: oneOf(m.pattern, MIC_PATTERNS, 'mic.pattern'),
    address: oneOf(m.address, MIC_ADDRESSES, 'mic.address'),
  }
}

function parseGoal(v: unknown): VoiceGoal {
  const g = obj(v, 'goal')
  const perceived = arr(g.perceived, PERCEIVED.length, 'goal.perceived').map((p) => oneOf(p, PERCEIVED, 'goal.perceived'))
  return { style: oneOf(g.style, STYLES, 'goal.style'), perceived: [...new Set(perceived)] }
}

function parseEq(v: unknown): EqBand {
  const e = obj(v, 'eq')
  const band: EqBand = {
    type: oneOf(e.type, EQ_TYPES, 'eq.type'),
    freq: num(e.freq, 20, 20000, 'eq.freq'),
    gain: num(e.gain, -40, 40, 'eq.gain'),
    bw: num(e.bw, 0.05, 8, 'eq.bw'),
    why: str(e.why, 'eq.why'),
  }
  return e.byEar === undefined ? band : { ...band, byEar: bool(e.byEar, 'eq.byEar') }
}

/** Strict rebuild of a settings JSON (throws on bad data); also validates applied settings (src/storage/applied.ts). */
export function parseSuggestion(v: unknown): SuggestionJson {
  const s = obj(v, 'suggestion')
  const g = obj(s.gate, 'gate')
  const c = obj(s.comp, 'comp')
  const n = (o: Obj, k: string) => num(o[k], -1e6, 1e6, k) // ranges: validateSuggestion below
  const nr = s.noiseReduction === null ? null : obj(s.noiseReduction, 'noiseReduction')
  const out: SuggestionJson = {
    basedOn: str(s.basedOn, 'basedOn'),
    speechDbfs: numOrNull(s.speechDbfs, -200, 50, 'speechDbfs'),
    noiseDbfs: numOrNull(s.noiseDbfs, -200, 50, 'noiseDbfs'),
    gainHint: str(s.gainHint, 'gainHint'),
    noiseHint: str(s.noiseHint, 'noiseHint'),
    dist: str(s.dist, 'dist', 40),
    lowcut: oneOf(s.lowcut, [80, 120] as const, 'lowcut'),
    gate: {
      threshold: n(g, 'threshold'),
      attack: n(g, 'attack'),
      hold: n(g, 'hold'),
      release: n(g, 'release'),
      hysteresis: n(g, 'hysteresis'),
      wet: n(g, 'wet'),
      dry: n(g, 'dry'),
    },
    eq: arr(s.eq, MAX_EQ, 'eq').map(parseEq),
    comp: {
      threshold: n(c, 'threshold'),
      ratio: n(c, 'ratio'),
      attack: n(c, 'attack'),
      release: n(c, 'release'),
      knee: num(c.knee, 0, 100, 'knee'),
      wet: n(c, 'wet'),
      limit: bool(c.limit, 'limit'),
    },
    deess: bool(s.deess, 'deess'),
    noisyRoom: bool(s.noisyRoom, 'noisyRoom'),
    noiseReduction: nr && {
      plugin: oneOf(nr.plugin, ['ReaFIR'] as const, 'noiseReduction.plugin'),
      steps: strList(nr.steps, 'noiseReduction.steps'),
      alternatives: strList(nr.alternatives, 'noiseReduction.alternatives'),
      ...(nr.preferAi === undefined ? {} : { preferAi: bool(nr.preferAi, 'noiseReduction.preferAi') }),
    },
    chain: strList(s.chain, 'chain', 40),
  }
  if (validateSuggestion(out).length) fail('suggestion ranges')
  return out
}

/** Exact Wave Link states: ReaPlugs names only; FXP blobs; ReaGate/ReaComp/ReaEQ must decode and round-trip. */
function parseStates(v: unknown): Record<string, string> {
  const o = obj(v, 'wavelinkStates')
  const out: Record<string, string> = {}
  for (const [name, state] of Object.entries(o)) {
    const plug = REAPLUGS.find((p) => p.name === name) ?? fail('wavelinkStates.name')
    const s = str(state, 'wavelinkStates.state', MAX_STATE)
    if (!B64.test(s) || s.length % 4 !== 0) fail('wavelinkStates.base64')
    let blob: Uint8Array = new Uint8Array()
    try {
      blob = b64decode(s)
    } catch {
      fail('wavelinkStates.base64')
    }
    if (!isFxp(blob) || (plug.kind && !roundTrips(plug.kind, blob))) fail('wavelinkStates.blob')
    out[name] = s
  }
  return out
}

function parseDevices(v: unknown): DeviceChoice {
  const d = obj(v, 'devices')
  return { raw: strOrNull(d.raw, 'devices.raw'), fx: strOrNull(d.fx, 'devices.fx') }
}

function parseValidation(v: unknown): ProfileValidation | null {
  if (v === null) return null
  const o = obj(v, 'validation')
  return {
    rawScore: num(o.rawScore, 0, 100, 'rawScore'),
    fxScore: num(o.fxScore, 0, 100, 'fxScore'),
    snrGain: num(o.snrGain, -500, 500, 'snrGain'),
    regressions: [...new Set(arr(o.regressions, REGRESSIONS.length, 'regressions').map((r) => oneOf(r, REGRESSIONS, 'regressions')))],
    date: date(o.date, 'validation.date'),
  }
}

/** Valid profile rebuilt from known keys, or null. `keepActive` keeps the local active flag (stored rows only). */
export function parseProfile(v: unknown, keepActive = false): Profile | null {
  try {
    const o = obj(v, 'profile')
    if (o.version !== 1) fail('version')
    const id = str(o.id, 'id', 100)
    if (!/^[A-Za-z0-9._:-]+$/.test(id)) fail('id')
    const name = str(o.name, 'name', MAX_NAME).trim()
    if (!name) fail('name')
    const p: Profile = {
      version: 1,
      id,
      name,
      created: date(o.created, 'created'),
      updated: date(o.updated, 'updated'),
      mic: parseMic(o.mic),
      host: o.host === null ? null : oneOf(o.host, HOSTS, 'host'),
      dist: str(o.dist, 'dist', 40),
      goal: parseGoal(o.goal),
      mains: oneOf(o.mains, [50, 60, 'auto'] as const, 'mains'),
      suggestion: parseSuggestion(o.suggestion),
      validation: parseValidation(o.validation),
    }
    if (o.wavelinkStates !== undefined) p.wavelinkStates = parseStates(o.wavelinkStates)
    if (o.devices !== undefined) p.devices = parseDevices(o.devices)
    if (keepActive && o.active === true) p.active = true
    return p
  } catch (e) {
    if (e instanceof Invalid) return null
    throw e
  }
}
