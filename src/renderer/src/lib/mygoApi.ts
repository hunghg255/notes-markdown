import { currentWindow, runtime } from 'mygo-runtime'
import type { Api, AppConfig, TreeNode, VaultEvent } from '@shared/types'
import { Config, Export, Shell, Vault, View, events } from './mygo'

// Go []byte parameters cross IPC as base64 strings
function toBase64(data: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < data.length; i += 0x8000) binary += String.fromCharCode(...data.subarray(i, i + 0x8000))
  return btoa(binary)
}

/** `window.api` backed by the Go services in src/main, through the generated client in ./mygo. */
export function installMygoApi() {
  const api: Api = {
    config: {
      get: () => Config.get() as Promise<AppConfig>,
      set: (patch) => Config.set(patch) as Promise<AppConfig>,
    },
    vault: {
      pickFolder: async () => (await Vault.pickFolder()) || null,
      tree: () => Vault.tree() as Promise<TreeNode[]>,
      read: (rel) => Vault.read(rel),
      write: (rel, content) => Vault.write(rel, content),
      create: (rel, content) => Vault.create(rel, content ?? ''),
      mkdir: (rel) => Vault.mkdir(rel),
      rename: (from, to) => Vault.rename(from, to),
      delete: (rel) => Vault.delete(rel),
      search: (query) => Vault.search(query),
      exists: (rel) => Vault.exists(rel),
      scan: () => Vault.scan(),
      writeBinary: (rel, data) => Vault.writeBinary(rel, toBase64(data)),
      replace: (find, replacement, paths, matchCase) => Vault.replace(find, replacement, paths, matchCase),
      onChanged: (cb) => events.vaultChanged.on((ev) => cb(ev as VaultEvent)),
    },
    shell: {
      openExternal: (url) => Shell.openExternal(url),
      showInFolder: (rel) => Shell.showInFolder(rel),
    },
    export: {
      file: async (kind, suggestedName, content) => (await Export.file(kind, suggestedName, content)) || null,
    },
    window: {
      minimize: () => void currentWindow.minimize(),
      maximize: () => void currentWindow.toggleMaximize(),
      close: () => void currentWindow.close(),
      zoom: (dir) => View.zoom(dir),
    },
    platform: runtime().platform,
  }
  window.api = api
}
