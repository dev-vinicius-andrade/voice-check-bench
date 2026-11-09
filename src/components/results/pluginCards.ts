// Plugin cards for the suggested settings (prototype renderSuggest). Plugin and parameter names stay literal;
// values are formatted for the active locale; the reasons go through i18n.
import type { TFunction } from 'i18next'
import { fmtHz, fmtInput, fmtInputSigned } from '../../i18n/format'
import type { Suggestion } from '../../types'
import type { PluginCardProps } from './PluginCard'

const DEFAULT_CHAIN = ['ReaGate', 'ReaEQ', 'ReaComp']
/** Whole numbers without decimals, others with one. */
const num = (v: number): string => fmtInput(v, Number.isInteger(v) ? 0 : 1)

/** Plugin order to set up; older suggestions without a chain use the classic gate → EQ → compressor. */
export const chainOf = (s: Suggestion): string[] => (s.chain?.length ? s.chain : DEFAULT_CHAIN)

/** "1st", "2nd"… position of a plugin in the chain; empty when it is not in the chain. */
export function tagOf(t: TFunction, s: Suggestion, name: string): string {
  const i = chainOf(s).indexOf(name)
  return i < 0 ? '' : t('results.settings.order', { count: i + 1, ordinal: true })
}

export function pluginCards(t: TFunction, s: Suggestion): PluginCardProps[] {
  const g = s.gate
  const c = s.comp
  const eqLabel = (type: string, bw: number): string => (bw < 0.3 ? `${type} · ${t('results.settings.notch')}` : type)
  const reaplugs: PluginCardProps[] = [
    {
      name: 'ReaGate',
      tag: tagOf(t, s, 'ReaGate'),
      rows: [
        ['Threshold', `${num(g.threshold)} dB`],
        ['Attack', `${num(g.attack)} ms`],
        ['Hold', `${num(g.hold)} ms`],
        ['Release', `${num(g.release)} ms`],
        ['Hysteresis', `${num(g.hysteresis)} dB`],
        ['Wet / Dry', `${num(g.wet)} / ${num(g.dry)} dB`],
      ],
      why: s.noisyRoom ? t('results.settings.whyGateNoisy') : t('results.settings.whyGate'),
    },
    {
      name: 'ReaEQ',
      tag: tagOf(t, s, 'ReaEQ'),
      rows: s.eq.length
        ? s.eq.map((e, i): [string, string] => [`${i + 1}. ${eqLabel(e.type, e.bw)}`, `${fmtHz(e.freq)} · ${fmtInputSigned(e.gain, 1)} · ${fmtInput(e.bw, e.bw < 0.3 ? 2 : 1)}`])
        : [[t('results.settings.noBands'), '—']],
      why: t('results.settings.whyEq'),
    },
    {
      name: 'ReaComp',
      tag: tagOf(t, s, 'ReaComp'),
      rows: [
        ['Threshold', `${num(c.threshold)} dB`],
        ['Ratio', `${num(c.ratio)}:1`],
        ['Attack / Release', `${num(c.attack)} / ${num(c.release)} ms`],
        ['Knee size', `${num(c.knee)} dB`],
        ['Wet (makeup)', `${fmtInputSigned(c.wet, Number.isInteger(c.wet) ? 0 : 1)} dB`],
        ['Limit output', t('results.settings.on')],
      ],
      why: t('results.settings.whyComp'),
    },
  ]
  const order = chainOf(s)
  reaplugs.sort((x, y) => (order.indexOf(x.name) + 1 || 99) - (order.indexOf(y.name) + 1 || 99))
  return [
    { name: 'Wave XLR', tag: t('results.settings.hardware'), rows: [['Lowcut Filter', `${num(s.lowcut)} Hz`]], why: s.lowcut === 120 ? t('results.settings.whyLowcut') : '' },
    ...reaplugs,
    {
      name: 'Elgato De-Esser',
      tag: '',
      rows: [['State', s.deess ? t('results.settings.onLight') : t('results.settings.off')]],
      why: s.deess ? t('results.settings.whyDeess') : '',
    },
  ]
}
