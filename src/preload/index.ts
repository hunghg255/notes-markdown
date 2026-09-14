import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type Api, type AppConfig, type VaultEvent } from '@shared/types'

const api: Api = {
  config: {
    get: () => ipcRenderer.invoke(IPC.configGet),
    set: (patch: Partial<AppConfig>) => ipcRenderer.invoke(IPC.configSet, patch),
  },
  vault: {
    pickFolder: () => ipcRenderer.invoke(IPC.vaultPickFolder),
    tree: () => ipcRenderer.invoke(IPC.vaultTree),
    read: (rel) => ipcRenderer.invoke(IPC.vaultRead, rel),
    write: (rel, content) => ipcRenderer.invoke(IPC.vaultWrite, rel, content),
    create: (rel, content) => ipcRenderer.invoke(IPC.vaultCreate, rel, content),
    mkdir: (rel) => ipcRenderer.invoke(IPC.vaultMkdir, rel),
    rename: (from, to) => ipcRenderer.invoke(IPC.vaultRename, from, to),
    delete: (rel) => ipcRenderer.invoke(IPC.vaultDelete, rel),
    search: (query) => ipcRenderer.invoke(IPC.vaultSearch, query),
    exists: (rel) => ipcRenderer.invoke(IPC.vaultExists, rel),
    scan: () => ipcRenderer.invoke(IPC.vaultScan),
    writeBinary: (rel, data) => ipcRenderer.invoke(IPC.vaultWriteBinary, rel, data),
    replace: (find, replacement, paths, matchCase) =>
      ipcRenderer.invoke(IPC.vaultReplace, find, replacement, paths, matchCase),
    onChanged: (cb) => {
      const listener = (_e: Electron.IpcRendererEvent, ev: VaultEvent) => cb(ev)
      ipcRenderer.on(IPC.eventVaultChanged, listener)
      return () => ipcRenderer.removeListener(IPC.eventVaultChanged, listener)
    },
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke(IPC.shellOpenExternal, url),
    showInFolder: (rel) => ipcRenderer.invoke(IPC.shellShowInFolder, rel),
  },
  export: {
    file: (kind, suggestedName, content) => ipcRenderer.invoke(IPC.exportFile, kind, suggestedName, content),
  },
  window: {
    minimize: () => ipcRenderer.send(IPC.windowMinimize),
    maximize: () => ipcRenderer.send(IPC.windowMaximize),
    close: () => ipcRenderer.send(IPC.windowClose),
  },
  platform: process.platform,
}

contextBridge.exposeInMainWorld('api', api)
