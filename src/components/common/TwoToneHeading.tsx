import Typography from '@mui/material/Typography'
import type { TypographyProps } from '@mui/material/Typography'

interface TwoToneHeadingProps {
  first: string
  second?: string
  variant?: TypographyProps['variant']
  component?: React.ElementType
  align?: TypographyProps['align']
}

/** andradev.io headline: uppercase, heavy, second line in the accent color. */
export function TwoToneHeading({ first, second, variant = 'h3', component = 'h1', align = 'center' }: TwoToneHeadingProps) {
  return (
    <Typography variant={variant} component={component} align={align} sx={{ textWrap: 'balance' }}>
      <span className="block">{first}</span>
      {second && (
        <Typography component="span" variant="inherit" color="primary" className="block">
          {second}
        </Typography>
      )}
    </Typography>
  )
}
