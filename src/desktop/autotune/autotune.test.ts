import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_SEC } from '../../audio/reference'
import type { TuneResult } from '../tune'
import { testTake } from '../tune/testTake'
import { AUTOTUNE_GOALS_KEY, DEFAULT_TUNE_GOALS, loadTuneGoals, parseTuneGoals, saveTuneGoals, toggleBother } from './goals'
import { RECORD_SEC, TakeRecorder } from './recorder'
import { forPlayback, metricRows } from './results'
import { prepareTake } from '../tune/measure'
import { checkTake } from './takeCheck'
import { testFrames } from './testRecording'
import { encodeWav, framesOf } from './testWav'
import { decodeWav, resampleLinear } from './wavDecode'

const SR = 48000
const ramp = (n: number, peak = 0.5): number[] => Array.from({ length: n }, (_, i) => (((i % 100) / 100) * 2 - 1) * peak)

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('decodeWav', () => {
  it('reads 16-bit mono at 48 kHz as is', () => {
    const x = ramp(SR * 12)
    const d = decodeWav(encodeWav(framesOf(x), { rate: SR, channels: 1, format: 1, bits: 16 }))
    if (!d.ok) throw new Error(d.reason)
    expect(d.take.length).toBe(x.length)
    expect(d.seconds).toBeCloseTo(12, 5)
    expect(d.take[37]).toBeCloseTo(x[37], 3)
  })

  it('averages stereo channels and resamples 44.1 kHz to 48 kHz (24-bit, extensible)', () => {
    const n = 44100 * 11
    const frames = Array.from({ length: n }, () => [0.5, -0.25])
    const d = decodeWav(encodeWav(frames, { rate: 44100, channels: 2, format: 1, bits: 24, extensible: true }))
    if (!d.ok) throw new Error(d.reason)
    expect(d.channels).toBe(2)
    expect(d.sourceRate).toBe(44100)
    expect(Math.abs(d.take.length - 11 * SR)).toBeLessThanOrEqual(1)
    expect(d.take[1000]).toBeCloseTo(0.125, 4)
  })

  it('reads 32-bit integer, 32-bit float and 64-bit float', () => {
    const want = ramp(51, 0.8)[50]
    for (const spec of [
      { format: 1, bits: 32 },
      { format: 3, bits: 32 },
      { format: 3, bits: 64 },
    ] as const) {
      const d = decodeWav(encodeWav(framesOf(ramp(SR * 10, 0.8)), { rate: SR, channels: 1, ...spec }))
      if (!d.ok) throw new Error(`${spec.format}/${spec.bits}: ${d.reason}`)
      expect(d.take[50]).toBeCloseTo(want, 4)
    }
  })

  it('keeps at most MAX_SEC seconds', () => {
    const d = decodeWav(encodeWav(framesOf(new Float32Array(8000 * (MAX_SEC + 5))), { rate: 8000, channels: 1, format: 1, bits: 16 }))
    if (!d.ok) throw new Error(d.reason)
    expect(d.seconds).toBeCloseTo(MAX_SEC, 3)
  })

  it('refuses other files, unsupported formats and recordings under 10 s', () => {
    expect(decodeWav(new TextEncoder().encode('not a wav file at all').buffer)).toEqual({ ok: false, reason: 'notWav' })
    expect(decodeWav(encodeWav(framesOf(ramp(SR * 12)), { rate: SR, channels: 1, format: 1, bits: 8 }))).toEqual({ ok: false, reason: 'format' })
    expect(decodeWav(encodeWav(framesOf(ramp(SR * 12), 3), { rate: SR, channels: 3, format: 1, bits: 16 }))).toEqual({ ok: false, reason: 'format' })
    expect(decodeWav(encodeWav(framesOf(ramp(SR * 9)), { rate: SR, channels: 1, format: 1, bits: 16 }))).toEqual({ ok: false, reason: 'tooShort' })
  })

  it('linear resampling interpolates between samples', () => {
    expect(Array.from(resampleLinear(Float32Array.from([0, 1, 2, 3]), 2, 4))).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3])
    const same = Float32Array.from([1, 2])
    expect(resampleLinear(same, 48000, 48000)).toBe(same)
  })
})

describe('goals', () => {
  it('keeps known values, drops the rest, dedupes bothers in screen order', () => {
    expect(parseTuneGoals(null)).toEqual(DEFAULT_TUNE_GOALS)
    expect(parseTuneGoals({ use: 'calls', style: 'warm', bothers: ['dull', 'roomNoise', 'dull', 'nasal', 3], amount: 'strong' })).toEqual({
      use: 'calls',
      style: 'warm',
      bothers: ['roomNoise', 'dull'],
      amount: 'strong',
    })
    expect(parseTuneGoals({ use: 'radio', style: 'loud', bothers: 'boomy', amount: 9 })).toEqual(DEFAULT_TUNE_GOALS)
  })

  it('round trips through localStorage and falls back when storage is blocked', () => {
    saveTuneGoals({ use: 'recording', style: 'bright', bothers: ['harsh'], amount: 'light' })
    expect(JSON.parse(localStorage.getItem(AUTOTUNE_GOALS_KEY) ?? 'null')).toMatchObject({ use: 'recording' })
    expect(loadTuneGoals()).toEqual({ use: 'recording', style: 'bright', bothers: ['harsh'], amount: 'light' })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(loadTuneGoals()).toEqual(DEFAULT_TUNE_GOALS)
    expect(() => saveTuneGoals(DEFAULT_TUNE_GOALS)).not.toThrow()
  })

  it('toggleBother adds and removes in screen order', () => {
    expect(toggleBother(['dull'], 'roomNoise')).toEqual(['roomNoise', 'dull'])
    expect(toggleBother(['roomNoise', 'dull'], 'roomNoise')).toEqual(['dull'])
  })
})

describe('TakeRecorder', () => {
  it('collects raw frames and is full at RECORD_SEC', () => {
    const r = new TakeRecorder()
    const results = testFrames(testTake({ quietSec: 3, speechSec: 23 })).map((f) => r.push(f))
    expect(results.indexOf('full')).toBe(RECORD_SEC * 10 - 1)
    expect(r.take().length).toBe(RECORD_SEC * SR)
    expect(r.seconds).toBe(RECORD_SEC)
  })

  it('a frame dropped on the way (or an input overrun) breaks the take', () => {
    const frames = testFrames(new Float32Array(SR * 2))
    const r = new TakeRecorder()
    expect(r.push(frames[0])).toBe('recording')
    expect(r.push({ ...frames[1], counters: { ...frames[1].counters, streamDropped: 1 } })).toBe('gap')
    expect(r.gap).toBe(true)
    expect(r.push(frames[2])).toBe('gap')
    const o = new TakeRecorder()
    o.push(frames[0])
    expect(o.push({ ...frames[1], counters: { ...frames[1].counters, inputOverruns: 2 } })).toBe('gap')
  })
})

describe('checkTake', () => {
  it('accepts a quiet lead then talking', () => {
    expect(checkTake(testTake({ quietSec: 3, speechSec: 20 }))).toBeNull()
  })

  it('accepts a loud, uneven room in the quiet lead: only talking over it asks for a new recording', () => {
    // the room is at −45 dBFS during the lead and the talking (voice at −24), then drops to −60 for the last seconds
    // (a fan cycling off): the lead is far louder than the quietest part of the take, which analyze() flags
    const loudRoom = testTake({ quietSec: 3, speechSec: 17, noiseDb: -45 })
    const calmRoom = testTake({ quietSec: 4, speechSec: 0, noiseDb: -60 })
    const take = new Float32Array(loudRoom.length + calmRoom.length)
    take.set(loudRoom)
    take.set(calmRoom, loudRoom.length)
    expect(prepareTake(take)?.analysis.quietBroken).toBe(true)
    expect(checkTake(take)).toBeNull()
    // the same room, but talking starts after half a second
    expect(checkTake(testTake({ quietSec: 0.5, speechSec: 20, noiseDb: -45 }))).toBe('quietBroken')
  })

  it('names what is wrong', () => {
    expect(checkTake(testTake({ quietSec: 3, speechSec: 5 }))).toBe('tooShort')
    expect(checkTake(new Float32Array(SR * 20))).toBe('silent')
    expect(checkTake(testTake({ quietSec: 3, speechSec: 20, speechDb: -64, noiseDb: -95 }))).toBe('tooQuiet')
    const loud = testTake({ quietSec: 3, speechSec: 20 }).map((v) => Math.max(-1, Math.min(1, v * 40)))
    expect(checkTake(loud)).toBe('clipped')
    expect(checkTake(testTake({ quietSec: 0.5, speechSec: 20 }))).toBe('quietBroken')
    // 6 s of talking, then the room only
    const little = testTake({ quietSec: 3, speechSec: 20 })
    const quiet = testTake({ quietSec: 23, speechSec: 0 })
    little.set(quiet.subarray(SR * 9), SR * 9)
    expect(checkTake(little)).toBe('notEnoughSpeech')
  })
})

describe('result rows', () => {
  const summary = (o: Partial<TuneResult['before']>): TuneResult['before'] => ({
    speechDb: -30,
    peakDb: -10,
    clipped: 0,
    pauseDb: -60,
    snrDb: 30,
    tone: [0, 4, 0, 0, 0, 0, 0, 0, 0],
    spreadDb: 10,
    deadSilence: 0,
    gateSwitches: 0,
    wordLossDb: 0,
    score: { level: 0, noise: 0, tone: 0, consistency: 0, damage: 0, total: 0 },
    ...o,
  })

  it('direction per metric; tone bands only when they moved 1 dB', () => {
    const rows = metricRows({
      before: summary({}),
      after: summary({ speechDb: -21, peakDb: -0.5, pauseDb: -70, snrDb: 49, spreadDb: 10.2, tone: [0, 1, 0.5, 0, 0, 0, 0, 0, 0] }),
      goals: DEFAULT_TUNE_GOALS,
      limit: 1,
    })
    expect(rows.map((r) => [r.id, r.dir])).toEqual([
      ['speech', 'better'],
      ['peak', 'worse'],
      ['noise', 'better'],
      ['snr', 'better'],
      ['spread', 'same'],
      ['band', 'better'],
    ])
    expect(rows[5].band).toBe(1)
  })

  it('a NaN summary (not enough speech) gives no rows', () => {
    const nan = summary({ speechDb: NaN, peakDb: NaN, pauseDb: NaN, snrDb: NaN, spreadDb: NaN, tone: new Array<number>(9).fill(NaN) })
    expect(metricRows({ before: nan, after: nan, goals: DEFAULT_TUNE_GOALS, limit: 1 })).toEqual([])
  })

  it('playback samples are clamped copies', () => {
    const x = Float32Array.from([1.5, -2, 0.25])
    expect(Array.from(forPlayback(x))).toEqual([1, -1, 0.25])
    expect(x[0]).toBe(1.5)
  })
})
