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
    // `mygo dev` loads this address (devUrl in mygo.config.ts)
    port: 5173,
    strictPort: true,
  },
  build: {
    // embedded into the app by `mygo build` (frontendDist in mygo.config.ts)
    outDir: resolve('out/renderer'),
    emptyOutDir: true,
  },
})
