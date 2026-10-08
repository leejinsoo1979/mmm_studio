const { app, BrowserWindow, shell } = require('electron')
const path = require('node:path')
const config = require('../runtime-config.json')
const {
  RETRY_DELAY_MS,
  SERVER_TIMEOUT_MS,
  planLaunch,
  resolveLaunchUrl,
  shouldRetryLoad,
  waitForServer,
  waitingPageUrl,
} = require('./launch.cjs')

app.commandLine.appendSwitch('enable-features', 'WebGPU')
app.commandLine.appendSwitch('enable-unsafe-webgpu')

function createWindow() {
  const window = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#111111',
    title: config.sceneName || 'MMM Studio Experience',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.once('ready-to-show', () => window.show())
  void launch(window)
}

async function launch(window) {
  const plan = planLaunch(process.env.MMM_PLAY_URL || config.playUrl, {
    packaged: app.isPackaged
  })
  const load = (url) => {
    if (!window.isDestroyed()) void window.loadURL(url).catch(() => {})
  }

  let retried = false
  window.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!shouldRetryLoad({ errorCode, isMainFrame, retried })) return
      retried = true
      const url = validatedURL || plan.url
      console.warn(`[runtime] ${url} failed to load (${errorDescription}); retrying once`)
      setTimeout(async () => {
        if (plan.origin) {
          load(waitingPageUrl(plan.origin))
          await waitForServer(plan.origin)
        }
        load(url)
      }, RETRY_DELAY_MS)
    }
  )

  if (plan.origin) load(waitingPageUrl(plan.origin))
  const { url, reason } = await resolveLaunchUrl(plan)
  if (reason === 'server-timeout') {
    console.warn(
      `[runtime] editor server at ${plan.origin} did not answer /api/health within ${SERVER_TIMEOUT_MS / 1000}s; loading ${url} anyway`
    )
  } else if (reason === 'scene-missing') {
    console.warn(
      `[runtime] scene ${plan.sceneId} (playUrl ${plan.url}) does not exist on this editor server; opening ${url} instead. Point MMM_PLAY_URL or runtime-config.json "playUrl" at an existing scene.`
    )
  }
  load(url)
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
