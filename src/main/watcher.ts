import chokidar, { type FSWatcher } from 'chokidar'
import path from 'node:path'
import type { BrowserWindow } from 'electron'
import { IPC, type VaultEvent } from '@shared/types'

let watcher: FSWatcher | null = null

export async function startWatcher(root: string, win: BrowserWindow): Promise<void> {
  await stopWatcher()
  watcher = chokidar.watch(root, {
    ignoreInitial: true,
    ignored: (p) => path.basename(p).startsWith('.') || p.endsWith('.tmp'),
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
  })
  const send = (type: VaultEvent['type'], abs: string) => {
    if (win.isDestroyed()) return
    const rel = path.relative(root, abs).split(path.sep).join('/')
    win.webContents.send(IPC.eventVaultChanged, { type, path: rel } satisfies VaultEvent)
  }
  watcher
    .on('add', (p) => send('add', p))
    .on('change', (p) => send('change', p))
    .on('unlink', (p) => send('unlink', p))
    .on('addDir', (p) => send('addDir', p))
    .on('unlinkDir', (p) => send('unlinkDir', p))
}

export async function stopWatcher(): Promise<void> {
  if (watcher) {
    await watcher.close()
    watcher = null
  }
}
