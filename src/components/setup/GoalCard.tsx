import Paper from '@mui/material/Paper'
import { GoalPicker } from '../common/GoalPicker'

/** Setup card: the voice goal (style + what you hear). */
export function GoalCard() {
  return (
    <Paper className="p-4 sm:p-5">
      <GoalPicker />
    </Paper>
  )
}
