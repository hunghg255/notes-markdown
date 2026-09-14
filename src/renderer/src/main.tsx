import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'katex/dist/katex.min.css'
import './index.css'

async function bootstrap() {
  if (!window.api && import.meta.env.DEV) {
    // running in a plain browser tab (no Electron preload): use an in-memory vault
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
