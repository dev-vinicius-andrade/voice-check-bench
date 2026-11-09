// Checks ported 1:1 from the prototype diagnose() (docs/prototype/voice-check.html). Pure.
import type { Analysis, Check, CheckId, Status } from '../types'
import { deviations } from './reference'

/** Signed number with one decimal: "+1.5", "-2.0", "0.0". */
export const f1 = (v: number): string => (v > 0 ? '+' : '') + v.toFixed(1)

export function diagnose(a: Analysis): Check[] {
  const C: Check[] = []
  const r = a.rel
  const add = (id: CheckId, status: Status, title: string, value: string, detail: string, fix: string): void => {
    C.push({ id, status, title, value, detail, fix })
  }

  // level
  {
    const v = a.speechMed
    const s: Status = v >= -26 && v <= -16 ? 'good' : v >= -32 && v <= -12 ? 'warn' : 'bad'
    add('level', s, 'Speech level', `${v.toFixed(1)} dBFS median`,
      s === 'good' ? 'Comfortable level for calls and streams.' : v < -26 ? 'Voice is quiet; listeners will turn you up, raising noise too.' : 'Voice is hot; risk of distortion and listener fatigue.',
      s === 'good' ? '' : v < -26 ? 'Raise compressor makeup gain (ReaComp wet) 3–6 dB, or Wave XLR gain a few dB.' : 'Lower Wave XLR gain or compressor makeup by 3–6 dB.')
  }
  {
    const s: Status = a.clip > 0 ? 'bad' : a.peak > -1 ? 'warn' : 'good'
    add('peaks', s, 'Peaks / clipping', `peak ${a.peak.toFixed(1)} dBFS · ${a.clip} clipped samples`,
      s === 'good' ? 'Headroom is fine.' : 'Peaks hit the ceiling and will crackle.',
      s === 'good' ? '' : "Lower gain 2–3 dB; keep ReaComp 'Limit output' on.")
  }
  {
    const n = a.noise
    const s: Status = n < -70 ? 'good' : n < -58 ? 'warn' : 'bad'
    add('noise', s, 'Background noise', `${n.toFixed(1)} dBFS in silence · SNR ${a.snr.toFixed(0)} dB`,
      (a.noiseFromQuiet ? '' : 'No clean 3 s silence found; estimate is rough. ') + (s === 'good' ? 'Pauses are clean.' : 'Hiss, fans or room noise are audible in pauses.'),
      s === 'good' ? '' : 'Move away from PC fans, lower gain and speak closer, or tighten ReaGate threshold.')
  }
  if (a.quietBroken) {
    add('silence', 'warn', 'Silence window', 'sound in first 3 s',
      'Something loud happened during the 3 s silence, so the noise reading may be off.',
      "Re-record and stay fully silent until the status says 'Read now'.")
  }
  if (a.hum.length) {
    const w = a.hum.reduce((m, h) => (h.db > m.db ? h : m))
    let s: Status = w.db < 6 ? 'good' : w.db < 12 ? 'warn' : 'bad'
    const gated = a.noise < -75
    if (gated && s === 'bad') s = 'warn'
    add('hum', s, 'Mains hum', `strongest ${w.hz} Hz, +${w.db.toFixed(1)} dB over neighbours`,
      s === 'good' ? 'No tonal hum in pauses.' : gated ? 'Pauses are silent, but the hum is still there under your voice while you talk (the gate only hides it in pauses).' : 'A steady buzz sits under your voice.',
      s === 'good' ? '' : 'Ground loop: try another USB port (rear, on the motherboard), unplug chargers on the same strip, keep XLR cable away from power bricks. ReaGate hides it in pauses only.')
  }

  const dv = deviations(r)
  const grade = (v: number): Status => (Math.abs(v) <= 3 ? 'good' : Math.abs(v) <= 6 ? 'warn' : 'bad')
  const band = (id: CheckId, i: number, title: string, okTxt: string, hiTxt: string, loTxt: string, hiFix: string, loFix: string): void => {
    const v = dv[i]
    const s = grade(v)
    const hi = v > 0
    add(id, s, title, `${f1(v)} dB vs reference`, s === 'good' ? okTxt : hi ? hiTxt : loTxt, s === 'good' ? '' : hi ? hiFix : loFix)
  }
  {
    const v = dv[0]
    const s: Status = v <= 3 ? 'good' : v <= 8 ? 'warn' : 'bad'
    add('rumble', s, 'Rumble (40–80 Hz)', `${f1(v)} dB vs reference`,
      s === 'good' ? 'Low-end rumble is controlled.' : 'Desk thumps, footsteps and AC rumble muddy the signal.',
      s === 'good' ? '' : "Keep Wave XLR Lowcut on (try 120 Hz); use a boom arm or shock mount so desk bumps don't reach the mic.")
  }
  band('boom', 1, 'Boom (80–160 Hz)', 'Bass is in a healthy range.', 'Too much bass, usually proximity effect from being very close to a dynamic mic.', 'Voice is thin in the bass.',
    'Back off 2–3 cm from the K688, or set ReaEQ low shelf at 150 Hz to -4/-5 dB.', 'Move 2 cm closer, or reduce the 150 Hz low shelf cut.')
  band('warmth', 2, 'Warmth (160–320 Hz)', 'Warmth is balanced.', 'Low-mid buildup makes the voice thick and muffled.', 'Voice lacks warmth and may sound thin.',
    'ReaEQ: cut around 250 Hz by 3–4 dB, bandwidth ~1.5.', 'Reduce the 300 Hz cut to -2 dB.')
  band('mud', 3, 'Mud / boxiness (320–640 Hz)', 'Low-mids are not masking your consonants.', "Boxy, cardboard sound that hides consonants; a top cause of 'not clear'.", 'Low-mids are scooped; voice can sound hollow.',
    'ReaEQ: cut 400–500 Hz by 3–4 dB, bandwidth ~1.2.', 'Reduce the 300 Hz cut, or move it lower (200 Hz).')
  band('body', 4, 'Body (640 Hz–1.25 kHz)', 'Core of the voice is solid.', 'Honky, nasal midrange.', 'The core of the voice is scooped out; lows and highs dominate, so it sounds hollow and distant.',
    'ReaEQ: cut ~900 Hz by 2–3 dB, bandwidth ~1.', 'ReaEQ: add +2/+3 dB at ~1 kHz, bandwidth ~1.5, and ease back the low shelf and highs.')
  band('definition', 5, 'Definition (1.25–2.5 kHz)', 'Vowel and consonant definition is fine.', "Forward, slightly nasal or 'telephone' tone.", 'Words lack definition.',
    'ReaEQ: cut ~1.8 kHz by 2 dB.', 'ReaEQ: +2 dB around 2 kHz, bandwidth ~1.5.')
  band('presence', 6, 'Presence (2.5–5 kHz)', 'Voice cuts through clearly.', 'Upper mids are pushed; can sound harsh or tiring.', 'Voice sounds dull and distant; this band carries clarity.',
    'Lower the 4 kHz boost by 2–3 dB.', 'Raise the 4 kHz band to +4/+5 dB, and speak on-axis into the top of the K688.')
  band('sibilance', 7, 'Sibilance (5–10 kHz)', 'S and T sounds are balanced.', 'S sounds are sharp and can hiss.', 'Consonants are dull.',
    'Turn on Elgato De-Esser, or lower the 10 kHz high shelf 2 dB; angle the mic slightly off your mouth.', 'Raise the 10 kHz high shelf to +4 dB.')
  band('air', 8, 'Air (10–16 kHz)', 'Some sparkle on top.', 'Lots of top end; can sound brittle or hissy.', 'Very little top end. Common for budget dynamics like the K688.',
    'Lower the 10 kHz high shelf 2 dB.', 'ReaEQ high shelf at 10 kHz +3 to +5 dB (watch sibilance).')
  if (a.sibP95 > -6) {
    add('harsh', 'warn', 'Harsh S peaks', `S-frames p95 ${a.sibP95.toFixed(1)} dB`,
      'Individual S sounds spike hard even if the average is fine.', 'Turn on Elgato De-Esser (light setting) after the EQ.')
  }
  {
    const v = a.spread
    const s: Status = v <= 8 ? 'good' : v <= 12 ? 'warn' : 'bad'
    add('consistency', s, 'Consistency', `${v.toFixed(1)} dB spread between seconds`,
      s === 'good' ? 'Loudness is steady.' : 'Level jumps between phrases; listeners will ride the volume.',
      s === 'good' ? '' : 'Keep the same distance (a fist away) and lower ReaComp threshold 3 dB.')
  }
  return C
}

/** Number of bad and warn checks. */
export function countByStatus(checks: readonly Check[]): { bad: number; warn: number } {
  let bad = 0
  let warn = 0
  for (const c of checks) {
    if (c.status === 'bad') bad++
    else if (c.status === 'warn') warn++
  }
  return { bad, warn }
}

/** The first n problems for verdicts: bad ones, then warn ones, never the silence-window note. */
export function topIssues(checks: readonly Check[], n = 3): Check[] {
  const bad = checks.filter((c) => c.status === 'bad')
  const warn = checks.filter((c) => c.status === 'warn')
  return [...bad, ...warn].filter((c) => c.id !== 'silence').slice(0, n)
}
