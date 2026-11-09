import { createTheme } from '@mui/material/styles'

// Visual language follows andradev.io: JetBrains Mono everywhere, olive accent (#b4b96b),
// flat surfaces (no shadows, thin borders), uppercase bold headlines, pill buttons/chips.
// Status colors are tuned for contrast: the site's olive success and warning are too close
// to tell apart in a status pill, so warning uses amber.

export const monoFont = '"JetBrains Mono", Consolas, monospace'
export const ACCENT = '#b4b96b'

export const theme = createTheme({
  cssVariables: { colorSchemeSelector: 'class' },
  colorSchemes: {
    light: {
      palette: {
        // #b4b96b is too pale on white for text and outlines; a deeper olive keeps the look and passes contrast.
        primary: { main: '#7d8233', light: ACCENT, dark: '#5f6326', contrastText: '#ffffff' },
        secondary: { main: '#222222', contrastText: '#ffffff' },
        info: { main: '#3f8aa1' },
        success: { main: '#6f7a14' },
        warning: { main: '#c07a00' },
        error: { main: '#e03c3c' },
        background: { default: '#ffffff', paper: '#ffffff' },
        text: { primary: '#222222', secondary: '#5f6368' },
        divider: 'rgba(34,34,34,0.12)',
      },
    },
    dark: {
      palette: {
        primary: { main: ACCENT, dark: '#8f9548', contrastText: '#121212' },
        secondary: { main: '#f5f5f5', contrastText: '#121212' },
        info: { main: '#4b9bb3' },
        success: { main: '#b3bb4b' },
        warning: { main: '#e5a530' },
        error: { main: '#ff4d4d' },
        background: { default: '#121212', paper: '#222222' },
        text: { primary: '#f5f5f5', secondary: '#a7a9a3' },
        divider: 'rgba(245,245,245,0.12)',
      },
    },
  },
  typography: {
    fontFamily: monoFont,
    h1: { fontWeight: 800, textTransform: 'uppercase', letterSpacing: '-0.01em', lineHeight: 1.05 },
    h2: { fontWeight: 800, textTransform: 'uppercase', letterSpacing: '-0.01em', lineHeight: 1.1 },
    h3: { fontWeight: 700, textTransform: 'uppercase', lineHeight: 1.15 },
    h4: { fontWeight: 700, textTransform: 'uppercase' },
    h5: { fontWeight: 700 },
    h6: { fontWeight: 700 },
    overline: { fontWeight: 700, letterSpacing: '0.12em' },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  shape: { borderRadius: 10 },
  components: {
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: { root: ({ theme: t }) => ({ backgroundImage: 'none', border: `1px solid ${t.palette.divider}` }) },
    },
    MuiCard: { defaultProps: { elevation: 0 } },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { borderRadius: 999, paddingInline: 18 } },
    },
    MuiChip: { styleOverrides: { root: { borderRadius: 999, fontWeight: 600 } } },
    MuiToggleButton: { styleOverrides: { root: { textTransform: 'none', fontWeight: 600 } } },
    MuiOutlinedInput: { styleOverrides: { root: { borderRadius: 15 } } },
    MuiAlert: { styleOverrides: { root: { borderRadius: 10 } } },
  },
})
