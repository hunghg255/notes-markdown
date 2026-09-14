import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { promises as fs } from 'node:fs'
import { IPC, type AppConfig, type VaultEvent } from '@shared/types'
import { loadConfig, updateConfig } from './config'
import { Vault } from './vault'
import { startWatcher } from './watcher'

let vault: Vault

export const getVault = () => vault

export async function setupVault(win: BrowserWindow): Promise<Vault> {
  const config = await loadConfig()
  vault = new Vault(config.vaultPath)
  await vault.init()
  await startWatcher(vault.root, win)
  return vault
}

async function switchVault(win: BrowserWindow, next: string): Promise<AppConfig> {
  const config = await updateConfig({ vaultPath: next })
  vault = new Vault(next)
  await vault.init()
  await startWatcher(vault.root, win)
  win.webContents.send(IPC.eventVaultChanged, { type: 'vaultChanged', path: next } satisfies VaultEvent)
  return config
}

export function registerIpc(win: BrowserWindow): void {
  ipcMain.handle(IPC.configGet, () => loadConfig())
  ipcMain.handle(IPC.configSet, async (_e, patch: Partial<AppConfig>) => {
    const current = await loadConfig()
    if (patch.vaultPath && patch.vaultPath !== current.vaultPath) {
      const { vaultPath, ...rest } = patch
      await updateConfig(rest)
      return switchVault(win, vaultPath)
    }
    return updateConfig(patch)
  })

  ipcMain.handle(IPC.vaultPickFolder, async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose notes folder',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IPC.vaultTree, () => vault.tree())
  ipcMain.handle(IPC.vaultRead, (_e, rel: string) => vault.read(rel))
  ipcMain.handle(IPC.vaultWrite, (_e, rel: string, content: string) => vault.write(rel, content))
  ipcMain.handle(IPC.vaultCreate, (_e, rel: string, content?: string) => vault.create(rel, content))
  ipcMain.handle(IPC.vaultMkdir, (_e, rel: string) => vault.mkdir(rel))
  ipcMain.handle(IPC.vaultRename, (_e, from: string, to: string) => vault.rename(from, to))
  ipcMain.handle(IPC.vaultDelete, (_e, rel: string) => vault.delete(rel))
  ipcMain.handle(IPC.vaultSearch, (_e, query: string) => vault.search(query))
  ipcMain.handle(IPC.vaultExists, (_e, rel: string) => vault.exists(rel))
  ipcMain.handle(IPC.vaultScan, () => vault.scan())
  ipcMain.handle(IPC.vaultWriteBinary, (_e, rel: string, data: Uint8Array) => vault.writeBinary(rel, data))
  ipcMain.handle(IPC.vaultReplace, (_e, find: string, replacement: string, paths: string[], matchCase: boolean) =>
    vault.replace(find, replacement, paths, matchCase),
  )

  ipcMain.handle(IPC.exportFile, async (_e, kind: 'pdf' | 'html' | 'md', suggestedName: string, content: string) => {
    const filters = {
      pdf: [{ name: 'PDF', extensions: ['pdf'] }],
      html: [{ name: 'HTML', extensions: ['html'] }],
      md: [{ name: 'Markdown', extensions: ['md'] }],
    }[kind]
    const result = await dialog.showSaveDialog(win, { defaultPath: `${suggestedName}.${kind}`, filters })
    if (result.canceled || !result.filePath) return null
    if (kind === 'pdf') {
      const printer = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
      try {
        await printer.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(content))
        const pdf = await printer.webContents.printToPDF({
          printBackground: true,
          pageSize: 'A4',
          margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 },
        })
        await fs.writeFile(result.filePath, pdf)
      } finally {
        printer.destroy()
      }
    } else {
      await fs.writeFile(result.filePath, content, 'utf8')
    }
    return result.filePath
  })

  ipcMain.handle(IPC.shellOpenExternal, (_e, url: string) => {
    if (/^(https?|mailto):/i.test(url)) return shell.openExternal(url)
    return undefined
  })
  ipcMain.handle(IPC.shellShowInFolder, (_e, rel: string) => vault.showInFolder(rel))

  ipcMain.on(IPC.windowMinimize, () => win.minimize())
  ipcMain.on(IPC.windowMaximize, () => (win.isMaximized() ? win.unmaximize() : win.maximize()))
  ipcMain.on(IPC.windowClose, () => win.close())
  // Chrome's preset zoom steps: fractional zoom levels make text render blurry on Windows
  const ZOOM_STEPS = [0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]
  ipcMain.handle(IPC.windowZoom, async (_e, dir: 'in' | 'out' | 'reset') => {
    const wc = win.webContents
    const current = wc.getZoomFactor()
    let idx = ZOOM_STEPS.findIndex((z) => Math.abs(z - current) < 0.01)
    if (idx === -1) idx = ZOOM_STEPS.indexOf(1)
    const nextIdx =
      dir === 'reset'
        ? ZOOM_STEPS.indexOf(1)
        : Math.min(ZOOM_STEPS.length - 1, Math.max(0, idx + (dir === 'in' ? 1 : -1)))
    const factor = ZOOM_STEPS[nextIdx]
    wc.setZoomFactor(factor)
    await updateConfig({ zoomLevel: factor })
    return factor
  })
}
