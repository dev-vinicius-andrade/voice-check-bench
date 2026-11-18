// @vitest-environment node
// Sanity run on a real recording (_test/control-2-cm-raw.wav, local and git-ignored) through the fake chain. Skips
// when the file is absent. It only checks the tuner's own promises (budget, never worse, no damage); what it decided
// is printed with `npx vitest run src/desktop/tune/tune.wav.test.ts --disable-console-intercept`.
import { describe, expect, it } from 'vitest'
import { chain as guideChain } from '../advice/testFixtures'
import { fakeRenderer } from './fakeRenderer'
import { DEFAULT_MAX_RENDERS } from './session'
import { tune } from './tune'
import { engineChanges, type TakeSummary, type TuneGoals, type TuneResult } from './types'

interface NodeFs {
  existsSync(p: URL): boolean
  readFileSync(p: URL): Uint8Array
}
const fsModule = 'node:fs'
const fs = (await import(/* @vite-ignore */ fsModule)) as NodeFs
const wavUrl = new URL('../../../_test/control-2-cm-raw.wav', import.meta.url)
const present = fs.existsSync(wavUrl)

/** Minimal RIFF/WAVE PCM decoder (16- or 32-bit int, or 32-bit float), channels averaged to mono. */
function decodeWav(bytes: Uint8Array): { samples: Float32Array; sampleRate: number } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (o: number): string => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3])
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file')
  let fmt = 0
  let channels = 0
  let sampleRate = 0
  let bits = 0
  let dataOff = -1
  let dataLen = 0
  for (let o = 12; o + 8 <= bytes.length; ) {
    const id = tag(o)
    const len = v.getUint32(o + 4, true)
    if (id === 'fmt ') {
      fmt = v.getUint16(o + 8, true)
      channels = v.getUint16(o + 10, true)
      sampleRate = v.getUint32(o + 12, true)
      bits = v.getUint16(o + 22, true)
    } else if (id === 'data') {
      dataOff = o + 8
      dataLen = Math.min(len, bytes.length - dataOff)
      break
    }
    o += 8 + len + (len & 1)
  }
  if (dataOff < 0) throw new Error('no data chunk')
  const bps = bits / 8
  const frames = Math.floor(dataLen / (bps * channels))
  const out = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    let s = 0
    for (let c = 0; c < channels; c++) {
      const o = dataOff + (i * channels + c) * bps
      s += fmt === 3 ? v.getFloat32(o, true) : bits === 16 ? v.getInt16(o, true) / 32768 : v.getInt32(o, true) / 2147483648
    }
    out[i] = s / channels
  }
  return { samples: out, sampleRate }
}

const f = (v: number): string => (Number.isFinite(v) ? v.toFixed(1) : String(v))
const line = (s: TakeSummary): string =>
  `speech ${f(s.speechDb)} peak ${f(s.peakDb)} pause ${f(s.pauseDb)} snr ${f(s.snrDb)} spread ${f(s.spreadDb)} dead ${s.deadSilence.toFixed(3)} loss ${f(s.wordLossDb)} tone [${s.tone.map(f).join(', ')}] score ${f(s.score.total)} (L${f(s.score.level)} N${f(s.score.noise)} T${f(s.score.tone)} C${f(s.score.consistency)} D${f(s.score.damage)})`

function report(name: string, r: TuneResult): string {
  return [
    `--- ${name}: ${r.renders} renders`,
    `before ${line(r.before)}`,
    `after  ${line(r.after)}`,
    ...engineChanges(r.changes).map((c) => `change slot ${c.slot} ${c.kind === 'switch' ? (c.on ? 'on' : 'off') : `${c.key} ${c.from} → ${c.to}`}`),
    ...r.changes.map((c) => `effect [${c.stage}] ${c.id} (${c.effect.metric}${c.effect.band ?? ''} ${f(c.effect.before)} → ${f(c.effect.after)})`),
    ...r.unmet.map((u) => `unmet ${u.key.replace('desktop.autotune.unmet.', '')} ${JSON.stringify(u.params ?? {})}`),
    ...r.log.map((l) => `  [${l.stage}] ${l.event}: ${l.text}`),
  ].join('\n')
}

describe.skipIf(!present)('tune on _test/control-2-cm-raw.wav (fake chain)', () => {
  const cases: [string, TuneGoals][] = [
    ['streaming, natural, nothing picked', { use: 'streaming', style: 'natural', bothers: [], amount: 'medium' }],
    ['streaming, natural, boomy + room noise', { use: 'streaming', style: 'natural', bothers: ['boomy', 'roomNoise'], amount: 'medium' }],
  ]
  for (const [name, goals] of cases) {
    it(name, async () => {
      const { samples, sampleRate } = decodeWav(fs.readFileSync(wavUrl))
      const chain = guideChain()
      const { render, calls } = fakeRenderer(samples, chain, { sampleRate })
      const r = await tune({ take: samples, sampleRate, chain, render, goals })
      console.log(report(`${name} (${(samples.length / sampleRate).toFixed(1)} s at ${sampleRate} Hz)`, r))
      expect(r.renders).toBeLessThanOrEqual(DEFAULT_MAX_RENDERS)
      expect(calls.length).toBe(r.renders)
      expect(r.after.score.total).toBeLessThanOrEqual(r.before.score.total)
      expect(r.after.score.damage).toBeLessThanOrEqual(r.before.score.damage + 1.5)
      expect(r.after.clipped).toBeLessThanOrEqual(r.before.clipped)
    }, 120_000)
  }
})
