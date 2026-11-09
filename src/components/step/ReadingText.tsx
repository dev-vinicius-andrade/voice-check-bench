import Typography from '@mui/material/Typography'
import { useBench } from '../../store/benchStore'

/** The prototype's reading passage (Portuguese, covers plosives, sibilants and nasals). */
const READING_TEXT =
  'Ontem à noite, o vento norte soprou forte sobre a cidade. A menina abriu a janela, olhou para o céu e decidiu terminar o livro antigo que ganhou do avô. Depois, preparou um café e chamou os amigos para jogar.'

/** Large reading text, dimmed until the reading phase starts. */
export function ReadingText() {
  const live = useBench((s) => s.recorder.phase === 'reading')
  return (
    <Typography
      lang="pt"
      sx={{
        fontSize: { xs: 20, sm: 24 },
        lineHeight: 1.65,
        m: 0,
        color: live ? 'text.primary' : 'text.secondary',
        opacity: live ? 1 : 0.75,
        transition: 'color .25s, opacity .25s',
      }}
    >
      {READING_TEXT}
    </Typography>
  )
}
