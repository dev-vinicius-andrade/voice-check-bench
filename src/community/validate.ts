// Strict parsing of shared community summaries (issue bodies are public, untrusted input). Framework-free.
// parseSummary rebuilds the object from known keys only, so extra keys never reach the index.
import type { EqBand, MicAddress, MicKind, MicPattern, NoiseKind, NoiseTone, StepKey, VoiceStyle } from '../types'

import type { CommunitySummary } from './types'

const GOAL_STYLES: readonly VoiceStyle[] = ['natural', 'warm', 'clear', 'bright']

type Obj = Record<string, unknown>
type Suggestion = NonNullable<CommunitySummary['suggestion']>
type TakeRow = CommunitySummary['takes'][number]

const MIC_KINDS: readonly MicKind[] = ['dynamic', 'condenser', 'unknown']
const MIC_PATTERNS: readonly MicPattern[] = ['cardioid', 'supercardioid', 'omni', 'figure8', 'unknown']
const MIC_ADDRESSES: readonly MicAddress[] = ['end', 'side', 'unknown']
const STEP_KEYS: readonly StepKey[] = ['c2', 'c8', 'c15', 'fx']
const NOISE_KINDS: readonly NoiseKind[] = ['quiet', 'hum', 'tonal', 'broadband']
const EQ_TYPES: readonly EqBand['type'][] = ['Low Shelf', 'Band', 'High Shelf']

export const MAX_MODEL_LEN = 80
export const MAX_TAKES = 5
export const MAX_TONES = 6
export const MAX_EQ = 12
const BAND_COUNT = 9
const MAX_TEXT = 2000
const MAX_LIST = 20

/** Thrown internally on the first invalid field; parseSummary turns it into null. */
class Invalid extends Error {}
const fail = (what: string): never => {
  throw new Invalid(what)
}

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const obj = (v: unknown, what: string): Obj => (isObj(v) ? v : fail(what))
const num = (v: unknown, lo: number, hi: number, what: string): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : fail(what)
const oneOf = <T extends string | number>(v: unknown, allowed: readonly T[], what: string): T =>
  allowed.includes(v as T) ? (v as T) : fail(what)
const str = (v: unknown, what: string): string => (typeof v === 'string' && v.length <= MAX_TEXT ? v : fail(what))
const bool = (v: unknown, what: string): boolean => (typeof v === 'boolean' ? v : fail(what))
const arr = (v: unknown, max: number, what: string): unknown[] => (Array.isArray(v) && v.length <= max ? v : fail(what))
const strList = (v: unknown, what: string): string[] => arr(v, MAX_LIST, what).map((s) => str(s, what))
/** Optional field: validated when present, default when absent. */
const opt = <T>(o: Obj, key: string, parse: (v: unknown) => T, dflt: T): T => (o[key] === undefined ? dflt : parse(o[key]))

/** A number, or NaN for JSON null (the app writes non-finite values as null). */
const numOrNull = (v: unknown, lo: number, hi: number, what: string): number => (v === null ? Number.NaN : num(v, lo, hi, what))

/** One value per BANDS entry. `nullable`: entries may be null (→ NaN) and the list may be empty (no silence window). */
const bands = (v: unknown, what: string, nullable = false): number[] => {
  const a = arr(v, BAND_COUNT, what)
  if (a.length !== BAND_COUNT && !(nullable && a.length === 0)) fail(what)
  return a.map((x) => (nullable ? numOrNull(x, -80, 80, what) : num(x, -80, 80, what)))
}

function parseMic(v: unknown): CommunitySummary['mic'] {
  const m = obj(v, 'mic')
  const model = typeof m.model === 'string' ? m.model.trim() : fail('mic.model')
  if (!model || model.length > MAX_MODEL_LEN) fail('mic.model')
  return {
    model,
    kind: oneOf(m.kind, MIC_KINDS, 'mic.kind'),
    pattern: oneOf(m.pattern, MIC_PATTERNS, 'mic.pattern'),
    address: oneOf(m.address, MIC_ADDRESSES, 'mic.address'),
  }
}

function parseTone(v: unknown): NoiseTone {
  const t = obj(v, 'tone')
  return { hz: num(t.hz, 20, 20000, 'tone.hz'), db: num(t.db, -20, 120, 'tone.db') }
}

/**
 * speechMed/noise/snr/rel are required. Takes without a usable silence window (or recorded before the noisy-room
 * mode) are still accepted: bandSnr may be empty or hold nulls (→ NaN), noiseKind may be null, spread/sibP95 may
 * be null (→ NaN).
 */
function parseTake(v: unknown): TakeRow {
  const t = obj(v, 'take')
  const step = t.step === null ? null : oneOf(t.step, STEP_KEYS, 'take.step')
  const a = obj(t.analysis, 'take.analysis')
  return {
    step,
    analysis: {
      speechMed: num(a.speechMed, -140, 0, 'speechMed'),
      noise: num(a.noise, -140, 0, 'noise'),
      snr: num(a.snr, -20, 120, 'snr'),
      rel: bands(a.rel, 'rel'),
      bandSnr: bands(a.bandSnr, 'bandSnr', true),
      tones: arr(a.tones, MAX_TONES, 'tones').map(parseTone),
      // the contract types noiseKind as non-null; old takes carry null, kept as-is (same cast as summary.ts)
      noiseKind: (a.noiseKind === null ? null : oneOf(a.noiseKind, NOISE_KINDS, 'noiseKind')) as NoiseKind,
      spread: numOrNull(a.spread, 0, 100, 'spread'),
      sibP95: numOrNull(a.sibP95, -80, 80, 'sibP95'),
    },
  }
}

function parseEq(v: unknown): EqBand {
  const e = obj(v, 'eq')
  return {
    type: oneOf(e.type, EQ_TYPES, 'eq.type'),
    freq: num(e.freq, 20, 20000, 'eq.freq'),
    gain: num(e.gain, -40, 40, 'eq.gain'),
    bw: num(e.bw, 0.01, 10, 'eq.bw'),
    why: opt(e, 'why', (x) => str(x, 'eq.why'), ''),
  }
}

function parseGate(v: unknown): Suggestion['gate'] {
  const g = obj(v, 'gate')
  const n = (k: string, lo: number, hi: number) => num(g[k], lo, hi, `gate.${k}`)
  return {
    threshold: n('threshold', -140, 0),
    attack: n('attack', 0, 10000),
    hold: n('hold', 0, 10000),
    release: n('release', 0, 10000),
    hysteresis: n('hysteresis', -140, 140),
    wet: n('wet', -140, 40),
    dry: n('dry', -200, 40),
  }
}

function parseComp(v: unknown): Suggestion['comp'] {
  const c = obj(v, 'comp')
  const n = (k: string, lo: number, hi: number) => num(c[k], lo, hi, `comp.${k}`)
  return {
    threshold: n('threshold', -140, 0),
    ratio: n('ratio', 1, 100),
    attack: n('attack', 0, 10000),
    release: n('release', 0, 10000),
    knee: n('knee', 0, 100),
    wet: n('wet', -140, 40),
    limit: opt(c, 'limit', (x) => bool(x, 'comp.limit'), true),
  }
}

function parseNoiseReduction(v: unknown): Suggestion['noiseReduction'] {
  if (v === null) return null
  const r = obj(v, 'noiseReduction')
  return {
    plugin: oneOf(r.plugin, ['ReaFIR'] as const, 'noiseReduction.plugin'),
    steps: opt(r, 'steps', (x) => strList(x, 'noiseReduction.steps'), []),
    alternatives: opt(r, 'alternatives', (x) => strList(x, 'noiseReduction.alternatives'), []),
  }
}

/** gate/comp/eq are required; the other fields are checked when present and defaulted when absent. */
function parseSuggestion(v: unknown): CommunitySummary['suggestion'] {
  if (v === null) return null
  const s = obj(v, 'suggestion')
  return {
    speechDbfs: opt(s, 'speechDbfs', (x) => num(x, -140, 0, 'speechDbfs'), Number.NaN),
    noiseDbfs: opt(s, 'noiseDbfs', (x) => num(x, -140, 0, 'noiseDbfs'), Number.NaN),
    gainHint: opt(s, 'gainHint', (x) => str(x, 'gainHint'), ''),
    noiseHint: opt(s, 'noiseHint', (x) => str(x, 'noiseHint'), ''),
    dist: opt(s, 'dist', (x) => str(x, 'dist'), ''),
    lowcut: opt(s, 'lowcut', (x) => oneOf(x, [80, 120] as const, 'lowcut'), 80),
    gate: parseGate(s.gate),
    eq: arr(s.eq, MAX_EQ, 'eq').map(parseEq),
    comp: parseComp(s.comp),
    deess: opt(s, 'deess', (x) => bool(x, 'deess'), false),
    noisyRoom: opt(s, 'noisyRoom', (x) => bool(x, 'noisyRoom'), false),
    noiseReduction: opt(s, 'noiseReduction', parseNoiseReduction, null),
    chain: opt(s, 'chain', (x) => strList(x, 'chain'), []),
  }
}

/** Valid summary rebuilt from known keys, or null when anything is missing, of the wrong type or out of range. */
export function parseSummary(v: unknown): CommunitySummary | null {
  try {
    const o = obj(v, 'summary')
    if (o.app !== 'voice-check-bench' || o.version !== 1) fail('app/version')
    const takes = arr(o.takes, MAX_TAKES, 'takes')
    if (!takes.length) fail('takes')
    return {
      app: 'voice-check-bench',
      version: 1,
      mic: parseMic(o.mic),
      takes: takes.map(parseTake),
      suggestion: parseSuggestion(o.suggestion),
      ...(GOAL_STYLES.includes(o.goalStyle as VoiceStyle) ? { goalStyle: o.goalStyle as VoiceStyle } : {}),
    }
  } catch (e) {
    if (e instanceof Invalid) return null
    throw e
  }
}

const SUMMARY_HEADING = /^###\s+Summary\s*$/im
const JSON_FENCE = /```json[^\n]*\n([\s\S]*?)```/i
const ANY_FENCE = /```[^\n]*\n([\s\S]*?)```/

/**
 * The JSON value from an issue-form body. Issue forms render the `summary` textarea (render: json) as
 * "### Summary" followed by a ```json fenced block. Takes the first ```json block of that section (else any
 * fenced block, else the section text); without the heading, the first ```json block of the body.
 * Returns undefined when nothing parses.
 */
export function extractSummaryFromIssueBody(body: string): unknown {
  if (typeof body !== 'string') return undefined
  const text = body.replace(/\r\n/g, '\n')
  const head = SUMMARY_HEADING.exec(text)
  let candidate: string | undefined
  if (head) {
    const rest = text.slice(head.index + head[0].length)
    const next = /^###\s/m.exec(rest)
    const section = next ? rest.slice(0, next.index) : rest
    candidate = JSON_FENCE.exec(section)?.[1] ?? ANY_FENCE.exec(section)?.[1] ?? section
  } else {
    candidate = JSON_FENCE.exec(text)?.[1]
  }
  if (candidate === undefined) return undefined
  try {
    return JSON.parse(candidate.trim()) as unknown
  } catch {
    return undefined
  }
}
