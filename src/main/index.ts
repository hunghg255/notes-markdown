import { app, BrowserWindow, Menu, net, protocol, shell } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { getVault, registerIpc, setupVault } from './ipc'
import { loadConfig } from './config'
import icon from '../../resources/icon.png?asset'
import { stopWatcher } from './watcher'

const isDev = !app.isPackaged && !!process.env.ELECTRON_RENDERER_URL

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    show: false,
    icon,
    backgroundColor: '#161616',
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 16, y: 16 } }
      : { titleBarOverlay: { color: '#161616', symbolColor: '#a3a3a3', height: 40 } }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      sandbox: false,
      webSecurity: true,
    },
  })

  win.on('ready-to-show', () => win.show())

  // restore the zoom the user picked with Ctrl+= / Ctrl+-
  win.webContents.on('did-finish-load', () => {
    void loadConfig().then((c) => {
      // zoomLevel holds a zoom *factor* (1 = 100%); older configs stored a Chromium level, ignore those
      if (c.zoomLevel && c.zoomLevel >= 0.5 && c.zoomLevel <= 3) win.webContents.setZoomFactor(c.zoomLevel)
    })
  })

  // no application menu (the renderer owns every shortcut); keep dev-tools access while developing
  win.webContents.on('before-input-event', (event, input) => {
    if (app.isPackaged || input.type !== 'keyDown' || !input.control) return
    const key = input.key.toLowerCase()
    if (input.shift && key === 'i') {
      win.webContents.toggleDevTools()
      event.preventDefault()
    } else if (!input.shift && key === 'r') {
      win.webContents.reload()
      event.preventDefault()
    }
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL!)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'vault', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
])

Menu.setApplicationMenu(null)

app.whenReady().then(async () => {
  // vault://local/<relative path> serves images and attachments from inside the notes folder
  protocol.handle('vault', (request) => {
    const url = new URL(request.url)
    const rel = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
    try {
      const abs = getVault().resolve(rel)
      return net.fetch(pathToFileURL(abs).toString())
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })

  const win = createWindow()
  await setupVault(win)
  registerIpc(win)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', async () => {
  await stopWatcher()
  if (process.platform !== 'darwin') app.quit()
})
