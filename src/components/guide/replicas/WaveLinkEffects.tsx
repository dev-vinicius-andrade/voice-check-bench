// Wave Link mic Effects list replica. Callout targets: row-<name>, toggle-<name>, settings-<name>, addEffect,
// lowcut (hardware Lowcut toggle; shown on with the `lowcut` prop's frequency selected).
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined'
import TuneIcon from '@mui/icons-material/Tune'
import Box from '@mui/material/Box'
import { useTranslation } from 'react-i18next'
import { Toggle } from './controls'
import { ReplicaFrame } from './ReplicaFrame'
import { highlightRing, RC } from './replicaStyle'
import { Spot } from './Spot'
import type { WaveLinkEffectsProps } from './types'

export const WAVELINK_TITLE = 'Wave Link'
const WIDTH = 460

function EffectRow({ name, order, on, highlight }: { name: string; order?: number; on: boolean; highlight: boolean }) {
  return (
    <Spot target={`row-${name}`} block>
      <Box
        data-testid="wl-row"
        data-effect={name}
        data-on={on}
        data-highlight={highlight}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.25,
          px: 1,
          py: 0.75,
          borderRadius: '6px',
          border: `1px solid ${RC.line}`,
          bgcolor: highlight ? RC.tint : RC.panel,
          color: on ? RC.ink : RC.muted,
          ...(highlight ? highlightRing : {}),
        }}
      >
        <Box component="span" sx={{ width: 18, textAlign: 'right', color: RC.muted, fontWeight: 700 }}>{order ?? ''}</Box>
        <Box component="span" sx={{ flex: 1, fontWeight: 600 }}>{name}</Box>
        <Spot target={`settings-${name}`}>
          <TuneIcon sx={{ fontSize: 18, color: RC.muted }} />
        </Spot>
        <DeleteOutlinedIcon sx={{ fontSize: 18, color: RC.muted }} />
        <Toggle on={on} target={`toggle-${name}`} />
      </Box>
    </Spot>
  )
}

export function WaveLinkEffects({ chain, off, highlight, lowcut, callouts }: WaveLinkEffectsProps) {
  const { t } = useTranslation()
  const offOnly = off.filter((name) => !chain.includes(name))
  const summary = [
    t('replicas.wl.order', { list: chain.join(' → ') }),
    ...(off.length ? [t('replicas.wl.off', { list: off.join(', ') })] : []),
    ...(highlight ? [t('replicas.wl.highlight', { name: highlight })] : []),
  ]
  return (
    <ReplicaFrame title={WAVELINK_TITLE} width={WIDTH} summary={summary} callouts={callouts} testId="replica-wavelink">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 1.5 }}>
        <Box component="span" sx={{ flex: 1, fontWeight: 600 }}>Lowcut</Box>
        {([80, 120] as const).map((f) => `${f} Hz` as const).map((hz) => (
          <Box key={hz} component="span" sx={{ px: 1, height: 22, display: 'inline-flex', alignItems: 'center', border: `1px solid ${hz === `${lowcut} Hz` ? RC.primary : RC.line}`, borderRadius: '4px', color: hz === `${lowcut} Hz` ? RC.primary : RC.muted, fontWeight: hz === `${lowcut} Hz` ? 700 : 400 }}>
            {hz}
          </Box>
        ))}
        <Toggle on={lowcut !== undefined} target="lowcut" />
      </Box>
      <Box sx={{ display: 'flex', gap: 2, borderBottom: `1px solid ${RC.line}`, mb: 1.25, pb: 0.5 }}>
        <Box component="span" sx={{ fontWeight: 700, borderBottom: `2px solid ${RC.primary}` }}>Effects</Box>
      </Box>
      <Box sx={{ display: 'grid', gap: 0.75 }}>
        {chain.map((name, i) => (
          <EffectRow key={name} name={name} order={i + 1} on={!off.includes(name)} highlight={name === highlight} />
        ))}
        {offOnly.map((name) => (
          <EffectRow key={name} name={name} on={false} highlight={name === highlight} />
        ))}
      </Box>
      <Box sx={{ mt: 1.25 }}>
        <Spot target="addEffect">
          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 1.25, height: 26, borderRadius: 999, border: `1px dashed ${RC.line}`, color: RC.ink }}>
            <AddIcon sx={{ fontSize: 16 }} /> Add effect
          </Box>
        </Spot>
      </Box>
    </ReplicaFrame>
  )
}
