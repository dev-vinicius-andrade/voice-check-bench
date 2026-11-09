// Panel steps of the Wave Link path: instructions with the person's values + the matching plugin replica.
import { useTranslation } from 'react-i18next'
import { fmtInput, fmtNum } from '../../i18n/format'
import { isNotch } from '../../settings/suggest'
import { isAnalysisError, type Suggestion } from '../../types'
import { useMsg } from '../common/MsgText'
import { calloutsOf, db, ms, num, oct, signedDb, type StepAction } from './guideFormat'
import { ReaCompPanel } from './replicas/ReaCompPanel'
import { ReaEqPanel } from './replicas/ReaEqPanel'
import { ReaFirPanel } from './replicas/ReaFirPanel'
import { ReaGatePanel } from './replicas/ReaGatePanel'
import { StepNote, StepText } from './StepText'
import type { ReaFirPhase } from './waveLinkSteps'

/** Stronger reduction when the voice is less than 15 dB over the room (matches the suggestion's ReaFIR plan). */
const STRONG_SNR = 15

function useField() {
  const { t } = useTranslation()
  return {
    set: (field: string, value: string, target?: string): StepAction => ({ text: t('guide.field.set', { field, value }), target }),
    type: (field: string, value: string, target?: string): StepAction => ({ text: t('guide.field.type', { field, value }), target }),
    choose: (field: string, value: string, target?: string): StepAction => ({ text: t('guide.field.choose', { field, value }), target }),
    tick: (field: string, target?: string): StepAction => ({ text: t('guide.field.tick', { field }), target }),
  }
}

export function ReaFirStep({ s, phase }: { s: Suggestion; phase: ReaFirPhase }) {
  const { t } = useTranslation()
  const f = useField()
  const a = s.base.analysis
  const snr = isAnalysisError(a) ? NaN : a.snr
  const amount = snr < STRONG_SNR ? db(15) : `${fmtNum(10, 0)}–${db(12)}`
  const actions: StepAction[] =
    phase === 'setup'
      ? [f.choose('Mode', 'Subtract', 'mode'), f.choose('FFT size', '4096', 'fftSize')]
      : phase === 'profile'
        ? [
            { text: t('guide.wl.reafir.profile.a1') },
            f.tick('Automatically build noise profile (enable during silence)', 'buildProfile'),
            { text: t('guide.wl.reafir.profile.a3') },
            { text: t('guide.wl.reafir.profile.a4'), target: 'buildProfile' },
          ]
        : [{ text: t('guide.wl.reafir.reduce.a1', { amount }), target: 'graph' }, { text: t('guide.wl.reafir.reduce.a2') }]
  return (
    <>
      <StepText lead={t(`guide.wl.reafir.${phase}.lead`)} actions={actions} />
      <ReaFirPanel phase={phase} callouts={calloutsOf(actions)} />
    </>
  )
}

export function EqStep({ s, band }: { s: Suggestion; band: number }) {
  const { t } = useTranslation()
  const tm = useMsg()
  const f = useField()
  const e = s.eq[band]
  const n = band + 1
  const actions: StepAction[] = [
    { text: t('guide.wl.eq.tab', { n }), target: `tab-${n}` },
    f.choose('Type', e.type, 'type'),
    f.type('Frequency (Hz)', String(Math.round(e.freq)), 'frequency'),
    f.type('Gain (dB)', fmtInput(e.gain, 1), 'gain'),
    f.type('Bandwidth (oct)', oct(e.bw), 'bandwidth'),
  ]
  return (
    <>
      <StepText
        lead={t('guide.wl.eq.lead', { why: tm(e.why) })}
        actions={actions}
        notes={
          <>
            {isNotch(e) && <StepNote>{t('guide.wl.eq.notch')}</StepNote>}
            {band === 0 && <StepNote>{t('guide.wl.eq.tabs', { total: s.eq.length })}</StepNote>}
          </>
        }
      />
      <ReaEqPanel eq={s.eq} activeBand={band} callouts={calloutsOf(actions)} />
    </>
  )
}

export function CompStep({ s }: { s: Suggestion }) {
  const { t } = useTranslation()
  const f = useField()
  const c = s.comp
  const actions: StepAction[] = [
    f.set('Threshold', db(c.threshold), 'threshold'),
    f.set('Ratio', `${num(c.ratio)}:1`, 'ratio'),
    f.set('Attack', ms(c.attack), 'attack'),
    f.set('Release', ms(c.release), 'release'),
    f.set('Knee size', db(c.knee), 'knee'),
    f.set('Wet', signedDb(c.wet), 'wet'),
    ...(c.limit ? [f.tick('Limit output', 'limit')] : []),
  ]
  return (
    <>
      <StepText lead={t('guide.wl.comp.lead')} actions={actions} />
      <ReaCompPanel comp={c} callouts={calloutsOf(actions)} />
    </>
  )
}

export function GateStep({ s }: { s: Suggestion }) {
  const { t } = useTranslation()
  const f = useField()
  const g = s.gate
  const actions: StepAction[] = [
    f.set('Threshold', db(g.threshold), 'threshold'),
    f.set('Attack', ms(g.attack), 'attack'),
    f.set('Hold', ms(g.hold), 'hold'),
    f.set('Release', ms(g.release), 'release'),
    f.set('Hysteresis', db(g.hysteresis), 'hysteresis'),
    f.set('Wet', db(g.wet), 'wet'),
    f.set('Dry', db(g.dry), 'dry'),
  ]
  return (
    <>
      <StepText lead={t(s.noisyRoom ? 'guide.wl.gate.leadNoisy' : 'guide.wl.gate.lead')} actions={actions} />
      <ReaGatePanel gate={g} callouts={calloutsOf(actions)} />
    </>
  )
}
