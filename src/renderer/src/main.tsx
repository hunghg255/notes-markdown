import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'katex/dist/katex.min.css'
import './index.css'

async function bootstrap() {
  // the myzig bridge defines window.myzig in every page of the app
  if ('myzig' in window) {
    const { installMyzigApi } = await import('./lib/myzigApi')
    installMyzigApi()
  } else if (import.meta.env.DEV) {
    // running in a plain browser tab (no myzig runtime): use an in-memory vault
    const { installMockApi } = await import('./lib/mockApi')
    installMockApi()
  }
  const { default: App } = await import('./App')
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void bootstrap()
