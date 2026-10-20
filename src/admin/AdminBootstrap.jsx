import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router/dom'
import App from '../App.jsx'
import { createAdminBrowserRouter } from '../app/navigation/adminRouter.jsx'
import { ThemeProvider } from '../app/shell/theme/ThemeProvider.jsx'
import { initializeTheme } from '../app/shell/theme/theme.js'
import '../index.css'
import '../theme.css'
import '../product-selection.css'
import '../mobile-compact-controls.css'
import '../mesiva-shell.css'

const router = createAdminBrowserRouter({ rootComponent: App })

export function mount(container) {
  initializeTheme()
  createRoot(container).render(
    <StrictMode>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </StrictMode>,
  )
}
