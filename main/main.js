const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const store = require('../src/store');
const linkedin = require('../src/linkedin');
const googleAuth = require('../src/googleAuth');
const sheets = require('../src/sheets');
const scheduler = require('../src/scheduler-mac');
const runner = require('../src/runner');

const isDailyTrigger = process.argv.includes('--run-daily');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 720,
    height: 780,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'renderer', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

function sendStatus(message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('status', message);
  }
}

app.whenReady().then(async () => {
  if (isDailyTrigger) {
    // Headless daily run triggered by launchd: do the work and quit, no window.
    try {
      await runner.runOnceSafe(() => {});
    } catch (e) {
      // Error already recorded to lastRun via runOnceSafe.
    }
    app.quit();
    return;
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- IPC handlers ----

ipcMain.handle('get-state', async () => {
  const config = store.getConfig();
  return {
    config,
    hasLinkedin: store.hasLinkedinSession(),
    hasGoogle: store.hasGoogleToken(),
    dailyCheckInstalled: scheduler.isInstalled()
  };
});

ipcMain.handle('save-search-url', async (evt, url) => {
  return store.saveConfig({ searchUrl: url || store.DEFAULT_SEARCH_URL });
});

ipcMain.handle('save-sheet-url', async (evt, url) => {
  const sheetId = sheets.extractSheetId(url);
  return store.saveConfig({ sheetUrl: url, sheetId });
});

ipcMain.handle('linkedin-login', async () => {
  await linkedin.loginInteractive(sendStatus);
  return { ok: true };
});

ipcMain.handle('linkedin-reconnect', async () => {
  store.clearLinkedinSession();
  await linkedin.loginInteractive(sendStatus);
  return { ok: true };
});

ipcMain.handle('google-connect', async () => {
  await googleAuth.signInInteractive((url) => shell.openExternal(url), sendStatus);
  return { ok: true };
});

ipcMain.handle('run-now', async () => {
  const result = await runner.runOnceSafe(sendStatus);
  return result;
});

ipcMain.handle('install-daily-check', async () => {
  await scheduler.install();
  store.saveConfig({ dailyCheckInstalled: true });
  return { ok: true };
});

ipcMain.handle('uninstall-daily-check', async () => {
  await scheduler.uninstall();
  store.saveConfig({ dailyCheckInstalled: false });
  return { ok: true };
});
