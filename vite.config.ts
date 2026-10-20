import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: 'src/renderer',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve('src/renderer/src'),
      '@shared': resolve('src/shared'),
      '@resources': resolve('resources'),
    },
  },
  server: {
    // `myzig dev` loads this address (dev_url in myzig.zon)
    port: 5173,
    strictPort: true,
  },
  build: {
    // embedded into the app by `myzig build` (frontend_dist in myzig.zon)
    outDir: resolve('out/renderer'),
    emptyOutDir: true,
  },
})
