const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('mmmDesktop', {
  platform: process.platform,
  desktop: true,
})
