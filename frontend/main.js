const { app, BrowserWindow, ipcMain, screen, shell } = require('electron');
const { powerMonitor } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const WIDGET_WIDTH = 400;
const WIDGET_HEIGHT = 600;
const DEVELOPMENT_WEB_URL = 'http://localhost:3001';
const PRODUCTION_WEB_URL = process.env.MAATI_WEB_URL || 'https://maati-web.onrender.com';
const IDLE_THRESHOLD_SECONDS = 60;
const TRACKER_TICK_MS = 1000;
const SAVE_EVERY_MS = 10_000;
const BREAK_VERIFY_MS = 5 * 60 * 1000;
const LIE_PENALTY_MS = 10 * 60 * 1000;

let widgetWindow;
let profileWindow;
let dimWindow;
let dimTimer;
let screenTimeFile;
let screenTime = { date: '', seconds: 0 };
let screenLocked = false;
let systemSuspended = false;
let trackerTimer;
let lastTrackerTick = 0;
let lastSavedAt = 0;
let pendingActiveMs = 0;

const webBaseUrl = (app.isPackaged ? PRODUCTION_WEB_URL : DEVELOPMENT_WEB_URL).replace(/\/$/, '');
const localWebOrigin = new URL(webBaseUrl).origin;

function appPageUrl(route = '/') {
  return new URL(route, `${webBaseUrl}/`).toString();
}

function openDesktopLink(link) {
  if (link !== 'maati://open') return;
  focusWidgetWindow();
}

function secureWindow(window) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') && new URL(url).origin !== localWebOrigin) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('maati://')) {
      event.preventDefault();
      openDesktopLink(url);
      return;
    }
    let destination;
    try { destination = new URL(url); } catch { event.preventDefault(); return; }
    if (destination.origin !== localWebOrigin && destination.protocol !== 'file:') event.preventDefault();
  });
}

const hasSingleInstance = app.requestSingleInstanceLock();
if (!hasSingleInstance) app.quit();
else {
  app.on('second-instance', (_event, commandLine) => {
    const link = commandLine.find(argument => argument.startsWith('maati://'));
    if (link) openDesktopLink(link);
    else focusWidgetWindow();
  });
  app.on('open-url', (event, link) => {
    event.preventDefault();
    openDesktopLink(link);
  });
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function currentScreenTime() {
  return { date: screenTime.date, seconds: screenTime.seconds };
}

function persistScreenTime() {
  if (!screenTimeFile) return;
  try {
    fs.writeFileSync(screenTimeFile, JSON.stringify(screenTime), 'utf8');
    lastSavedAt = Date.now();
  } catch (error) {
    console.error('Could not save Maati screen time:', error);
  }
}

function broadcastScreenTime() {
  const snapshot = currentScreenTime();
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send('screen-time:update', snapshot);
    }
  }
}

function rollScreenTimeDay() {
  const today = localDateKey();
  if (screenTime.date === today) return false;
  screenTime = { date: today, seconds: 0 };
  pendingActiveMs = 0;
  persistScreenTime();
  broadcastScreenTime();
  return true;
}

function isSystemActive() {
  if (screenLocked || systemSuspended) return false;
  try {
    return powerMonitor.getSystemIdleState(IDLE_THRESHOLD_SECONDS) === 'active';
  } catch {
    return false;
  }
}

function startScreenTimeTracker() {
  screenTimeFile = path.join(app.getPath('userData'), 'maati-screen-time.json');
  try {
    const saved = JSON.parse(fs.readFileSync(screenTimeFile, 'utf8'));
    if (saved?.date === localDateKey() && Number.isFinite(saved.seconds) && saved.seconds >= 0) {
      screenTime = { date: saved.date, seconds: Math.floor(saved.seconds) };
    }
  } catch {
    screenTime = { date: localDateKey(), seconds: 0 };
  }

  try {
    screenLocked = powerMonitor.getSystemIdleState(IDLE_THRESHOLD_SECONDS) === 'locked';
  } catch {
    screenLocked = false;
  }
  lastTrackerTick = Date.now();
  lastSavedAt = lastTrackerTick;

  powerMonitor.on('lock-screen', () => {
    screenLocked = true;
    pendingActiveMs = 0;
    persistScreenTime();
  });
  powerMonitor.on('unlock-screen', () => {
    screenLocked = false;
    lastTrackerTick = Date.now();
    pendingActiveMs = 0;
  });
  powerMonitor.on('suspend', () => {
    systemSuspended = true;
    pendingActiveMs = 0;
    persistScreenTime();
  });
  powerMonitor.on('resume', () => {
    systemSuspended = false;
    lastTrackerTick = Date.now();
    pendingActiveMs = 0;
    try {
      screenLocked = powerMonitor.getSystemIdleState(IDLE_THRESHOLD_SECONDS) === 'locked';
    } catch {
      screenLocked = false;
    }
  });

  trackerTimer = setInterval(() => {
    const now = Date.now();
    const elapsedMs = Math.min(Math.max(now - lastTrackerTick, 0), TRACKER_TICK_MS * 2);
    lastTrackerTick = now;
    if (rollScreenTimeDay()) return;

    if (isSystemActive()) {
      pendingActiveMs += elapsedMs;
      const elapsedWholeSeconds = Math.floor(pendingActiveMs / 1000);
      if (elapsedWholeSeconds > 0) {
        screenTime.seconds += elapsedWholeSeconds;
        pendingActiveMs -= elapsedWholeSeconds * 1000;
        broadcastScreenTime();
      }
    } else {
      pendingActiveMs = 0;
    }

    if (now - lastSavedAt >= SAVE_EVERY_MS) persistScreenTime();
  }, TRACKER_TICK_MS);
}

function createWidgetWindow() {
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea;

  widgetWindow = new BrowserWindow({
    width: WIDGET_WIDTH,
    height: WIDGET_HEIGHT,
    x: x + width - WIDGET_WIDTH,
    y: y + height - WIDGET_HEIGHT,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  widgetWindow.setAlwaysOnTop(true);
  secureWindow(widgetWindow);
  if (typeof widgetWindow.setShape === 'function') {
    widgetWindow.setShape([{ x: 160, y: 360, width: 240, height: 240 }]);
  }
  widgetWindow.loadURL(appPageUrl('/widget'));
  widgetWindow.on('closed', () => {
    widgetWindow = null;
  });
}

function focusWidgetWindow() {
  if (!widgetWindow || widgetWindow.isDestroyed()) return createWidgetWindow();
  widgetWindow.show();
  widgetWindow.setAlwaysOnTop(true);
  widgetWindow.focus();
}

function createDimWindow() {
  if (dimWindow && !dimWindow.isDestroyed()) return dimWindow;
  const display = screen.getPrimaryDisplay();
  dimWindow = new BrowserWindow({
    x: display.bounds.x, y: display.bounds.y, width: display.bounds.width, height: display.bounds.height,
    transparent: true, frame: false, alwaysOnTop: true, hasShadow: false, resizable: false,
    focusable: false, skipTaskbar: true, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  dimWindow.setAlwaysOnTop(true, 'screen-saver');
  dimWindow.setIgnoreMouseEvents(true, { forward: true });
  dimWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;width:100%;height:100%;background:rgba(0,0,0,.42);overflow:hidden}</style></head><body></body></html>'));
  dimWindow.once('ready-to-show', () => dimWindow && !dimWindow.isDestroyed() && dimWindow.show());
  dimWindow.on('closed', () => { dimWindow = null; });
  return dimWindow;
}

function stopDimWindow() {
  if (dimTimer) clearTimeout(dimTimer);
  dimTimer = null;
  if (dimWindow && !dimWindow.isDestroyed()) dimWindow.close();
  dimWindow = null;
}

function startDimFor(durationMs) {
  const duration = Math.min(Math.max(Number(durationMs) || 0, 1000), LIE_PENALTY_MS);
  if (!duration) return;
  createDimWindow();
  if (dimTimer) clearTimeout(dimTimer);
  dimTimer = setTimeout(stopDimWindow, duration);
}

function verifyBreakAfterAccept() {
  const startedAt = Date.now();
  let moved = false;
  let lastPoint = screen.getCursorScreenPoint();
  return new Promise(resolve => {
    const finish = (verified, reason) => {
      clearInterval(cursorTimer);
      if (!verified) startDimFor(LIE_PENALTY_MS);
      resolve({ verified, reason });
    };
    const cursorTimer = setInterval(() => {
      const elapsedSeconds = (Date.now() - startedAt) / 1000;
      const point = screen.getCursorScreenPoint();
      if (point.x !== lastPoint.x || point.y !== lastPoint.y) moved = true;
      lastPoint = point;
      let idleSeconds = 0;
      try { idleSeconds = powerMonitor.getSystemIdleTime(); } catch {}
      if (moved) return finish(false, 'cursor_moved');
      // The accept click itself resets OS idle time, so allow a short startup grace.
      if (elapsedSeconds > 4 && idleSeconds + 2 < elapsedSeconds) return finish(false, 'system_not_idle');
      if (elapsedSeconds >= BREAK_VERIFY_MS / 1000) finish(idleSeconds >= 5 * 60 - 2, idleSeconds >= 5 * 60 - 2 ? 'verified' : 'system_not_idle');
    }, 250);
  });
}

function openProfileWindow(route = '/profile') {
  const safeRoute = ['/auth', '/profile', '/profile?setup=1'].includes(route) ? route : '/profile';
  if (profileWindow && !profileWindow.isDestroyed()) {
    if (safeRoute !== '/profile') profileWindow.loadURL(appPageUrl(safeRoute));
    profileWindow.focus();
    return;
  }
  profileWindow = new BrowserWindow({ width: 1180, height: 860, minWidth: 760, minHeight: 600, title: 'Maati Profile', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  secureWindow(profileWindow);
  profileWindow.loadURL(appPageUrl(safeRoute));
  profileWindow.on('closed', () => { profileWindow = null; });
}

ipcMain.on('widget:set-input-regions', (event, regions) => {
  const targetWindow = BrowserWindow.fromWebContents(event.sender);
  if (!targetWindow || typeof targetWindow.setShape !== 'function' || !Array.isArray(regions)) return;

  const [windowWidth, windowHeight] = targetWindow.getContentSize();
  const shape = regions
    .filter((region) => region && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(region[key])))
    .map(({ x, y, width, height }) => {
      const left = Math.max(0, Math.floor(x));
      const top = Math.max(0, Math.floor(y));
      const right = Math.min(windowWidth, Math.ceil(x + width));
      const bottom = Math.min(windowHeight, Math.ceil(y + height));
      return { x: left, y: top, width: right - left, height: bottom - top };
    })
    .filter((region) => region.width > 0 && region.height > 0);

  if (shape.length > 0) targetWindow.setShape(shape);
});

ipcMain.handle('screen-time:get', () => {
  rollScreenTimeDay();
  return currentScreenTime();
});

ipcMain.handle('screen-time:reset', () => {
  rollScreenTimeDay();
  screenTime.seconds = 0;
  pendingActiveMs = 0;
  persistScreenTime();
  broadcastScreenTime();
  return currentScreenTime();
});

ipcMain.handle('screen-dim:start', (_event, durationMs) => startDimFor(durationMs));

ipcMain.handle('screen-dim:stop', () => stopDimWindow());
ipcMain.handle('break:verify', () => verifyBreakAfterAccept());
ipcMain.handle('widget:focus', () => focusWidgetWindow());
ipcMain.handle('profile:open', (_event, route) => openProfileWindow(route));

app.whenReady().then(() => {
  if (!hasSingleInstance) return;
  app.setAsDefaultProtocolClient('maati');
  const startupLink = process.argv.find(argument => argument.startsWith('maati://'));
  startScreenTimeTracker();
  createWidgetWindow();
  if (startupLink) openDesktopLink(startupLink);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWidgetWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (trackerTimer) clearInterval(trackerTimer);
  stopDimWindow();
  persistScreenTime();
});
