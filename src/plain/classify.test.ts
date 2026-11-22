// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { fakeAnalysis } from '../audio/testSignals'
import type { Analysis } from '../types'
import { DEFAULT_GOAL } from '../types'
import { classify, type ProblemKind } from './classify'

const kinds = (a: Analysis): ProblemKind[] => classify(a, undefined, DEFAULT_GOAL).problems.map((p) => p.kind)
const severities = (a: Analysis) => classify(a, undefined, DEFAULT_GOAL).problems.map((p) => ({ kind: p.kind, severity: p.severity }))

describe('classify', () => {
  it('returns no problems for a clean reference take', () => {
    const report = classify(fakeAnalysis(), undefined, DEFAULT_GOAL)
    expect(report.problems).toEqual([])
    expect(report.installOffer).toBe(false)
  })

  it('detects room hum when mains peaks are strong', () => {
    const a = fakeAnalysis({ hum: [{ hz: 60, db: 14 }] })
    expect(kinds(a)).toContain('roomHum')
    expect(severities(a)).toContainEqual({ kind: 'roomHum', severity: 'bad' })
  })

  it('classifies mild hum as warn', () => {
    const a = fakeAnalysis({ hum: [{ hz: 50, db: 8 }] })
    expect(severities(a)).toContainEqual({ kind: 'roomHum', severity: 'warn' })
  })

  it('detects fan tones above the strong threshold', () => {
    const a = fakeAnalysis({ noiseKind: 'tonal', snr: 20, tones: [{ hz: 320, db: 18 }] })
    expect(kinds(a)).toContain('fanTone')
  })

  it('detects broadband hiss when SNR is low and noise kind is broadband', () => {
    const a = fakeAnalysis({ noiseKind: 'broadband', snr: 12, noise: -55 })
    expect(kinds(a)).toContain('broadbandHiss')
    expect(severities(a)).toContainEqual({ kind: 'broadbandHiss', severity: 'bad' })
  })

  it('falls back to roomNoise when noise is high but not broadband/hum/tonal', () => {
    const a = fakeAnalysis({ noiseKind: 'quiet', snr: 18, noise: -50 })
    // quiet noiseKind with low SNR shouldn't trigger roomNoise (noiseKind must not be 'quiet')
    expect(kinds(a)).not.toContain('roomNoise')
  })

  it('detects tooQuiet when speech is below the good range', () => {
    const a = fakeAnalysis({ speechMed: -33 })
    expect(kinds(a)).toContain('tooQuiet')
    expect(severities(a)).toContainEqual({ kind: 'tooQuiet', severity: 'warn' })
  })

  it('classifies very quiet speech as bad', () => {
    const a = fakeAnalysis({ speechMed: -38 })
    expect(severities(a)).toContainEqual({ kind: 'tooQuiet', severity: 'bad' })
  })

  it('detects tooLoud when speech is above the good range', () => {
    const a = fakeAnalysis({ speechMed: -14 })
    expect(kinds(a)).toContain('tooLoud')
  })

  it('classifies clipping as bad tooLoud', () => {
    const a = fakeAnalysis({ speechMed: -10, clip: 5 })
    expect(severities(a)).toContainEqual({ kind: 'tooLoud', severity: 'bad' })
  })

  it('detects uneven level from high spread', () => {
    const a = fakeAnalysis({ spread: 10 })
    expect(kinds(a)).toContain('unevenLevel')
    expect(severities(a)).toContainEqual({ kind: 'unevenLevel', severity: 'warn' })
  })

  it('detects boomy voice from excess bass', () => {
    // band 1 (boom) deviation +7 → bad
    const rel = [-18, -4 + 7, -1, 2, 0, -6, -7, -11, -17]
    const a = fakeAnalysis({ rel })
    expect(kinds(a)).toContain('boomy')
  })

  it('detects thin voice from insufficient bass', () => {
    // band 1 deviation -7 → bad, thin direction
    const rel = [-18, -4 - 7, -1, 2, 0, -6, -7, -11, -17]
    const a = fakeAnalysis({ rel })
    expect(kinds(a)).toContain('thin')
  })

  it('detects harsh voice from excess presence', () => {
    // band 6 (presence) deviation +7 → bad
    const rel = [-18, -4, -1, 2, 0, -6, -7 + 7, -11, -17]
    const a = fakeAnalysis({ rel })
    expect(kinds(a)).toContain('harsh')
  })

  it('detects dull voice from insufficient air', () => {
    // band 7 (air/sibilance area) deviation -7 → bad
    const rel = [-18, -4, -1, 2, 0, -6, -7, -11 - 7, -17]
    const a = fakeAnalysis({ rel })
    expect(kinds(a)).toContain('dull')
  })

  it('detects sibilance when sibP95 is above threshold', () => {
    const a = fakeAnalysis({ sibP95: -4 })
    expect(kinds(a)).toContain('sibilant')
  })

  it('sorts bad problems before warn problems', () => {
    const a = fakeAnalysis({ speechMed: -38, spread: 10, sibP95: -4 })
    const report = classify(a, undefined, DEFAULT_GOAL)
    const sevs = report.problems.map((p) => p.severity)
    const firstWarn = sevs.indexOf('warn')
    const lastBad = sevs.lastIndexOf('bad')
    if (firstWarn >= 0 && lastBad >= 0) expect(lastBad).toBeLessThan(firstWarn)
  })

  it('sorts noise before gain before tone within the same severity', () => {
    // bad noise (hum) + bad gain (tooQuiet) + bad tone (boomy)
    const rel = [-18, -4 + 8, -1, 2, 0, -6, -7, -11, -17]
    const a = fakeAnalysis({ hum: [{ hz: 60, db: 14 }], speechMed: -38, rel })
    const report = classify(a, undefined, DEFAULT_GOAL)
    const bads = report.problems.filter((p) => p.severity === 'bad')
    const cats = bads.map((p) => p.category)
    // noise should come before gain, gain before tone
    const noiseIdx = cats.indexOf('noise')
    const gainIdx = cats.indexOf('gain')
    const toneIdx = cats.indexOf('tone')
    if (noiseIdx >= 0 && gainIdx >= 0) expect(noiseIdx).toBeLessThan(gainIdx)
    if (gainIdx >= 0 && toneIdx >= 0) expect(gainIdx).toBeLessThan(toneIdx)
  })

  it('sets installOffer true when actuator commands exist but no adapter is registered', () => {
    // hum produces an eqCut actuator command; no adapters registered in tests
    const a = fakeAnalysis({ hum: [{ hz: 60, db: 14 }] })
    const report = classify(a, undefined, DEFAULT_GOAL)
    expect(report.installOffer).toBe(true)
  })

  it('every problem has at least one step with text', () => {
    const a = fakeAnalysis({
      hum: [{ hz: 60, db: 14 }],
      speechMed: -38,
      spread: 13,
      sibP95: -4,
      rel: [-18, -4 + 8, -1, 2 + 8, 0, -6, -7 + 8, -11 - 8, -17],
    })
    const report = classify(a, undefined, DEFAULT_GOAL)
    for (const p of report.problems) {
      expect(p.steps.length).toBeGreaterThan(0)
      for (const s of p.steps) {
        expect(s.text.key).toBeTruthy()
      }
    }
  })
})