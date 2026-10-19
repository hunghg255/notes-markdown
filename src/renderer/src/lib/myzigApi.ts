import type { Api, AppConfig, TreeNode, VaultEvent } from '@shared/types'
// generated from the Zig services in src/main by `myzig dev` / `myzig generate`
import { Channel, Config, Export, Shell, Vault, View, myzig, onVaultChanged, type ExportResult } from '../../myzig.js'

// Zig []const u8 binary parameters cross IPC as base64 strings
function toBase64(data: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < data.length; i += 0x8000) binary += String.fromCharCode(...data.subarray(i, i + 0x8000))
  return btoa(binary)
}

const platforms = { windows: 'win32', macos: 'darwin', linux: 'linux' } as const

/** `window.api` backed by the Zig services in src/main, through the generated client in src/renderer/myzig.js. */
export function installMyzigApi() {
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
      onChanged: (cb) => onVaultChanged((ev) => cb(ev as VaultEvent)),
    },
    shell: {
      openExternal: (url) => Shell.openExternal(url),
      showInFolder: (rel) => Shell.showInFolder(rel),
    },
    export: {
      // the result comes through the channel once the file is written (a PDF renders after the call returns)
      file: async (kind, suggestedName, content) => {
        const done = new Channel<ExportResult>()
        await Export.file(kind, suggestedName, content, done)
        for await (const result of done) {
          if (result.message) throw new Error(`Export.file: ${result.message}`)
          return result.path || null
        }
        return null
      },
    },
    window: {
      minimize: () => myzig.window.minimize(),
      maximize: () => myzig.window.toggleMaximize(),
      close: () => myzig.window.close(),
      zoom: (dir) => View.zoom(dir),
    },
    platform: platforms[myzig.platform],
  }
  window.api = api
}
