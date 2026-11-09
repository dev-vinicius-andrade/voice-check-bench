import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { StyledEngineProvider, ThemeProvider } from '@mui/material/styles'
import CssBaseline from '@mui/material/CssBaseline'
import GlobalStyles from '@mui/material/GlobalStyles'
import './index.css'
import { theme } from './theme'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StyledEngineProvider enableCssLayer>
      <ThemeProvider theme={theme} defaultMode="system">
        {/* Must render before CssBaseline: the first @layer statement fixes the layer order. */}
        <GlobalStyles styles="@layer theme, base, mui, components, utilities;" />
        <CssBaseline />
        <App />
      </ThemeProvider>
    </StyledEngineProvider>
  </StrictMode>,
)
