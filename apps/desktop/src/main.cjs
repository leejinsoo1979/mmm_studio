const { app, BrowserWindow, session, shell, utilityProcess } = require('electron')
const http = require('node:http')
const path = require('node:path')

// OAuth popups (Firebase signInWithPopup) must open as real child windows —
// everything else goes to the system browser. Google additionally rejects
// user agents that advertise Electron ("disallowed_useragent"), so the
// session UA is stripped to plain Chrome before any window loads.
const AUTH_POPUP_HOSTS = ['accounts.google.com', 'github.com', 'appleid.apple.com', 'kauth.kakao.com']

function isAuthPopupUrl(raw) {
  try {
    const { hostname } = new URL(raw)
    if (hostname.endsWith('.firebaseapp.com')) return true // __/auth/handler
    return AUTH_POPUP_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`))
  } catch {
    return false
  }
}

// The editor renders through WebGPU — same flags as the Play runtime.
app.commandLine.appendSwitch('enable-features', 'WebGPU')
app.commandLine.appendSwitch('enable-unsafe-webgpu')

const DEV_EDITOR_URL = process.env.MMM_DESKTOP_URL || 'http://localhost:3002'
const EMBEDDED_PORT = 3521
// `localhost` (not 127.0.0.1): Firebase auth's default authorized domains
// include localhost only — 127.0.0.1 fails with auth/unauthorized-domain.
const EMBEDDED_URL = `http://localhost:${EMBEDDED_PORT}`

let serverProcess = null

/**
 * Packaged builds embed the editor's Next standalone output (see
 * scripts/bundle-editor.mjs) and boot it with Electron's own Node via a
 * utility process. Dev runs (`electron .` from the repo) skip this and
 * load the regular `bun dev` server instead.
 */
function startEmbeddedServer() {
  const serverEntry = path.join(
    process.resourcesPath,
    'app.asar.unpacked',
    'bundle',
    'apps',
    'editor',
    'server.js',
  )
  serverProcess = utilityProcess.fork(serverEntry, [], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(EMBEDDED_PORT),
      HOSTNAME: '127.0.0.1',
    },
    stdio: 'inherit',
  })
}

function waitForServer(url, timeoutMs = 30000) {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const probe = () => {
      const request = http.get(`${url}/api/health`, (response) => {
        response.resume()
        if (response.statusCode && response.statusCode < 500) return resolve(undefined)
        retry()
      })
      request.on('error', retry)
      request.setTimeout(2000, () => {
        request.destroy()
        retry()
      })
    }
    const retry = () => {
      if (Date.now() - started > timeoutMs) return reject(new Error('editor server timed out'))
      setTimeout(probe, 400)
    }
    probe()
  })
}

function createWindow(url) {
  const window = new BrowserWindow({
    width: 1680,
    height: 1050,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#111111',
    title: 'MMM Studio',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  window.webContents.setWindowOpenHandler(({ url: external }) => {
    if (isAuthPopupUrl(external)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520,
          height: 720,
          autoHideMenuBar: true,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        },
      }
    }
    void shell.openExternal(external)
    return { action: 'deny' }
  })

  window.once('ready-to-show', () => window.show())
  void window.loadURL(url)
  return window
}

app.whenReady().then(async () => {
  // Strip Electron/app tokens so Google sign-in accepts the browser.
  const chromeUserAgent = session.defaultSession
    .getUserAgent()
    .replace(/\sElectron\/[\d.]+/g, '')
    .replace(/\s\S*mmm\S*\/[\d.]+/gi, '')
  session.defaultSession.setUserAgent(chromeUserAgent)

  let url = DEV_EDITOR_URL
  if (app.isPackaged) {
    startEmbeddedServer()
    url = EMBEDDED_URL
    try {
      await waitForServer(EMBEDDED_URL)
    } catch {
      // Window still opens; Chromium shows its load error if the server died.
    }
  }
  createWindow(url)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(url)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  serverProcess?.kill()
  serverProcess = null
})
