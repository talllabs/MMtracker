const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('get-state'),
  saveSearchUrl: (url) => ipcRenderer.invoke('save-search-url', url),
  saveSheetUrl: (url) => ipcRenderer.invoke('save-sheet-url', url),
  linkedinLogin: () => ipcRenderer.invoke('linkedin-login'),
  linkedinReconnect: () => ipcRenderer.invoke('linkedin-reconnect'),
  googleConnect: () => ipcRenderer.invoke('google-connect'),
  runNow: () => ipcRenderer.invoke('run-now'),
  installDailyCheck: () => ipcRenderer.invoke('install-daily-check'),
  uninstallDailyCheck: () => ipcRenderer.invoke('uninstall-daily-check'),
  onStatus: (cb) => ipcRenderer.on('status', (evt, message) => cb(message))
});
