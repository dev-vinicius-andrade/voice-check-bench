// A glossary term in running text: the label plus a small info button whose tooltip gives the plain meaning
// and an everyday analogy (src/plain/glossary.ts). Opens on hover, keyboard focus, click or tap.
import { useState, type ReactNode } from 'react'
import ClickAwayListener from '@mui/material/ClickAwayListener'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import { useTranslation } from 'react-i18next'
import { glossaryEntry, type GlossaryId } from '../../plain/glossary'
import { MsgText, useMsg } from './MsgText'

export function Term({ id, children }: { id: GlossaryId; children: ReactNode }) {
  const { t } = useTranslation()
  const tm = useMsg()
  const [open, setOpen] = useState(false)
  const entry = glossaryEntry(id)
  const title = (
    <span className="grid gap-1">
      <span><MsgText msg={entry.meaning} /></span>
      <span><MsgText msg={entry.analogy} /></span>
    </span>
  )
  return (
    <span className="inline-flex items-baseline">
      {children}
      <ClickAwayListener onClickAway={() => setOpen(false)}>
        <Tooltip
          title={title}
          open={open}
          onOpen={() => setOpen(true)}
          onClose={() => setOpen(false)}
          describeChild
          disableTouchListener
          arrow
        >
          <IconButton
            size="small"
            aria-label={t('results.term.info', { term: tm(entry.term) })}
            onClick={() => setOpen(true)}
            sx={{ p: 0.25, ml: 0.25, alignSelf: 'center', color: 'text.secondary' }}
          >
            <InfoOutlinedIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      </ClickAwayListener>
    </span>
  )
}
