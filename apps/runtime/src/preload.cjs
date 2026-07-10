const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('mmmRuntime', {
  platform: process.platform,
  desktop: true
})
