import { useId, useState } from 'react'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import TextField from '@mui/material/TextField'

export interface NameDialogProps {
  open: boolean
  title: string
  label: string
  confirm: string
  cancel: string
  initial: string
  onClose(): void
  onConfirm(name: string): void
  children?: React.ReactNode
}

/** Small dialog with one name field (rename, save as profile). The field resets each time the dialog opens. */
export function NameDialog(props: NameDialogProps) {
  const titleId = useId()
  return (
    <Dialog open={props.open} onClose={props.onClose} aria-labelledby={titleId} fullWidth maxWidth="xs">
      {props.open && <NameForm {...props} titleId={titleId} />}
    </Dialog>
  )
}

function NameForm({ title, label, confirm, cancel, initial, onClose, onConfirm, children, titleId }: NameDialogProps & { titleId: string }) {
  const [name, setName] = useState(initial)
  const ok = name.trim() !== ''
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (ok) onConfirm(name.trim())
      }}
    >
      <DialogTitle id={titleId}>{title}</DialogTitle>
      <DialogContent className="grid gap-3">
        {children}
        <TextField autoFocus fullWidth size="small" margin="dense" label={label} value={name} onChange={(e) => setName(e.target.value)} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{cancel}</Button>
        <Button type="submit" variant="contained" disabled={!ok}>{confirm}</Button>
      </DialogActions>
    </form>
  )
}
