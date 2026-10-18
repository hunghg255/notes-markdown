import { defineConfig } from 'mygo-cli'
import pkg from './package.json' with { type: 'json' }

export default defineConfig({
  name: 'Notes',
  identifier: 'com.giahung.notes-markdown',
  version: pkg.version,
  icon: 'resources/icon.png',
  // the Go app lives in src/main; `mygo dev` runs devCommand and loads devUrl,
  // `mygo build` runs buildCommand and embeds frontendDist
  main: './src/main',
  devUrl: 'http://localhost:5173',
  devCommand: 'pnpm dev:web',
  buildCommand: 'pnpm build:web',
  frontendDist: 'out/renderer',
  bindings: 'src/renderer/src/lib/mygo.ts',
  out: 'release',
})
