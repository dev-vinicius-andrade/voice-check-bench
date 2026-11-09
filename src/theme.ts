import { createTheme } from '@mui/material/styles'

export const monoFont = '"JetBrains Mono", Consolas, monospace'

export const theme = createTheme({
  cssVariables: { colorSchemeSelector: 'class' },
  colorSchemes: {
    light: {
      palette: {
        primary: { main: '#d98a10', contrastText: '#fff' },
        info: { main: '#3d7bd9' },
        success: { main: '#2f8f4e' },
        warning: { main: '#c07a00' },
        error: { main: '#c43c33' },
        background: { default: '#eef0f2', paper: '#ffffff' },
      },
    },
    dark: {
      palette: {
        primary: { main: '#f0a630', contrastText: '#1b1306' },
        info: { main: '#6aa3ff' },
        success: { main: '#4cc073' },
        warning: { main: '#e5a530' },
        error: { main: '#ef6a5f' },
        background: { default: '#14181c', paper: '#1d2329' },
        text: { primary: '#e6eaee', secondary: '#93a0ac' },
      },
    },
  },
  typography: {
    fontFamily: 'Barlow, "Segoe UI", system-ui, sans-serif',
    button: { textTransform: 'none', fontWeight: 600 },
  },
  shape: { borderRadius: 10 },
})
