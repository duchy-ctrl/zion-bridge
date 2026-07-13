// Zion Bridge — proces principal Electron.
// Tray + fereastră de status + IPC + notificări + pornire la Windows.
'use strict';
const { app, BrowserWindow, Tray, Menu, ipcMain, Notification, nativeImage, shell, dialog } = require('electron');
const path = require('path');

const settingsStore = require('./settings');
const log = require('./logger');
const state = require('./state');
const fiscal = require('./fiscal/fiscal');
const printjobs = require('./printers/printjobs');
const dude = require('./fiscal/dude');
const tools = require('./tools');

let win = null;
let tray = null;
let quitting = false;

// ---------- o singură instanță (două poduri = bonuri duble!) ----------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => { showWindow(); });
  app.whenReady().then(boot);
}

// ---------- plase de siguranță: aplicația NU crapă ----------
process.on('uncaughtException', (e) => log.error('app', 'Excepție neprinsă: ' + (e.stack || e.message)));
process.on('unhandledRejection', (e) => log.error('app', 'Promise respins neprins: ' + (e && e.stack || e)));

// ---------- jurnal live (evenimente curate pentru UI) ----------
const journal = [];
function pushJournal(kind, msg) {
  const entry = { t: Date.now(), kind, msg };
  journal.push(entry);
  if (journal.length > 300) journal.shift();
  if (win && !win.isDestroyed()) win.webContents.send('journal', entry);
}

// ---------- notificări toast ----------
function notify(title, body) {
  try {
    if (Notification.isSupported()) new Notification({ title, body, silent: false }).show();
  } catch (e) { log.debug('app', 'Notificare eșuată: ' + e.message); }
}

// ---------- tray ----------
function iconPath(name) { return path.join(__dirname, '..', '..', 'assets', name); }

function trayIconFor(status) {
  const printerProblem = Object.entries(status.printers)
    .some(([k, p]) => p.ok === false);
  const fiscalProblem = status.fiscal.enabled && (status.fiscal.paused || (status.fiscal.error && !status.fiscal.ok));
  if (!status.cloud.ok) return 'tray-err.png';
  if (fiscalProblem) return 'tray-err.png';
  if (printerProblem) return 'tray-warn.png';
  return 'tray-ok.png';
}

function updateTray(status) {
  if (!tray) return;
  try {
    tray.setImage(nativeImage.createFromPath(iconPath(trayIconFor(status))));
    const probs = [];
    if (!status.cloud.ok) probs.push('cloud: ' + (status.cloud.error || 'deconectat'));
    if (status.fiscal.paused) probs.push('fiscal: PAUZĂ (parolă)');
    else if (status.fiscal.error && !status.fiscal.ok && status.fiscal.enabled) probs.push('fiscal: ' + status.fiscal.error);
    for (const [k, p] of Object.entries(status.printers)) if (p.ok === false) probs.push(`${k}: ${p.error}`);
    tray.setToolTip(probs.length ? 'Zion Bridge — ' + probs.join(' | ').slice(0, 120) : 'Zion Bridge — totul funcționează');
  } catch (_) {}
}

function trayMenu() {
  const items = [
    { label: 'Deschide Zion Bridge', click: showWindow },
    { type: 'separator' },
    { label: `Versiune ${app.getVersion()}`, enabled: false }
  ];
  if (updater.available) {
    items.push({ label: '⬇ Repornește și actualizează acum', click: () => updater.install() });
  } else {
    items.push({ label: updater.ok ? 'Verifică actualizări' : 'Verifică actualizări (indisponibil)', enabled: updater.ok, click: () => updater.check(true) });
  }
  items.push(
    { type: 'separator' },
    { label: 'Deschide folderul cu loguri', click: () => shell.openPath(log.logsDir()) },
    { type: 'separator' },
    { label: 'Ieșire completă', click: () => { quitting = true; app.quit(); } }
  );
  return Menu.buildFromTemplate(items);
}
function createTray() {
  tray = new Tray(nativeImage.createFromPath(iconPath('tray-ok.png')));
  tray.setToolTip('Zion Bridge');
  tray.setContextMenu(trayMenu());
  tray.on('double-click', showWindow);
  tray.on('click', showWindow);
}

// ---------- auto-update (GitHub Releases, electron-updater) ----------
// Tolerant: dacă modulul lipsește (npm install nerulat) sau rulăm în dev, podul merge normal, doar fără update.
const updater = { ok: false, available: false, check: () => {}, install: () => {} };
function initUpdater() {
  if (!app.isPackaged) { log.info('update', 'Mod dev — auto-update dezactivat.'); return; }
  let autoUpdater;
  try { autoUpdater = require('electron-updater').autoUpdater; }
  catch (e) { log.warn('update', 'electron-updater lipsă (rulează npm install) — auto-update dezactivat.'); return; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;   // dacă nimeni nu apasă nimic, se instalează la următoarea repornire
  autoUpdater.on('update-available', (info) => {
    pushJournal('info', `Actualizare disponibilă: ${info.version} — se descarcă în fundal...`);
  });
  autoUpdater.on('update-downloaded', (info) => {
    updater.available = true;
    if (tray) tray.setContextMenu(trayMenu());
    pushJournal('ok', `Actualizarea ${info.version} e gata — se aplică la repornire (sau din tray: „Repornește și actualizează acum").`);
    notify('Zion Bridge — actualizare', `Versiunea ${info.version} e descărcată. Se instalează la repornire.`);
  });
  autoUpdater.on('error', (e) => log.warn('update', 'Auto-update: ' + (e && e.message || e)));
  updater.ok = true;
  updater.check = (manual) => {
    autoUpdater.checkForUpdates().then(r => {
      if (manual && !(r && r.updateInfo && r.updateInfo.version !== app.getVersion()))
        notify('Zion Bridge', 'Ai deja ultima versiune (' + app.getVersion() + ').');
    }).catch(e => {
      log.warn('update', 'Verificare eșuată: ' + (e && e.message || e));
      if (manual) notify('Zion Bridge', 'Nu am putut verifica actualizările — vezi logul.');
    });
  };
  updater.install = () => { quitting = true; dude.shutdown(); autoUpdater.quitAndInstall(); };
  updater.check(false);                                   // la pornire
  setInterval(() => updater.check(false), 6 * 3600 * 1000); // apoi la fiecare 6 ore
  log.info('update', 'Auto-update activ (GitHub duchy-ctrl/zion-bridge).');
}

// ---------- fereastra ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1020, height: 720, minWidth: 860, minHeight: 560,
    show: false,
    icon: iconPath('icon.ico'),
    backgroundColor: '#0f1420',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.on('close', (e) => {
    if (!quitting) { e.preventDefault(); win.hide(); } // X → minimizare în tray, podul merge mai departe
  });
  win.once('ready-to-show', () => {
    const s = settingsStore.load();
    // prima rulare (setup) sau utilizatorul nu vrea pornire minimizată → arătăm fereastra
    if (!s.setupDone || !s.startMinimized) win.show();
  });
}

function showWindow() {
  if (!win || win.isDestroyed()) createWindow();
  win.show();
  win.focus();
}

// ---------- autostart la Windows ----------
function applyAutostart() {
  const s = settingsStore.load();
  try {
    app.setLoginItemSettings({ openAtLogin: !!s.startAtLogin, args: [] });
  } catch (e) { log.warn('app', 'Autostart: ' + e.message); }
}

// ---------- IPC ----------
function registerIpc() {
  ipcMain.handle('get-status', () => state.getStatus());
  ipcMain.handle('get-settings', () => settingsStore.load());
  ipcMain.handle('save-settings', (_e, partial) => {
    const s = settingsStore.save(partial);
    log.setDebug(!!s.debugLog);
    applyAutostart();
    state.syncPrinters(s.printers);
    log.info('app', 'Setări salvate');
    if (s.fiscal && state.getStatus().fiscal.paused) fiscal.resume(); // parola corectată → reluăm
    return s;
  });
  ipcMain.handle('get-journal', () => journal.slice());
  ipcMain.handle('get-log', () => log.recent());

  ipcMain.handle('test-fiscal', async () => {
    pushJournal('info', 'Test bon fiscal pornit...');
    const nrbon = await fiscal.testReceipt();
    pushJournal('ok', `Test bon fiscal reușit — bon #${nrbon || '?'}`);
    return nrbon;
  });
  ipcMain.handle('test-fiscal-conn', async () => fiscal.testConnection());
  ipcMain.handle('test-printer', async (_e, key) => {
    pushJournal('info', `Test imprimantă ${key}...`);
    await printjobs.testPrinter(key);
    pushJournal('ok', `Test imprimantă ${key} reușit`);
    return true;
  });
  ipcMain.handle('detect-dude', () => tools.detectDude());
  ipcMain.handle('scan-network', async (e, port) => {
    return tools.scanPort(port, (pct) => {
      if (win && !win.isDestroyed()) win.webContents.send('scan-progress', pct);
    });
  });
  ipcMain.handle('resume-fiscal', () => { fiscal.resume(); return true; });
  ipcMain.handle('open-logs', () => shell.openPath(log.logsDir()));
  ipcMain.handle('app-version', () => app.getVersion());
}

// ---------- pornire ----------
function boot() {
  app.setAppUserModelId('ro.ziongardens.bridge'); // necesar pentru toast-uri pe Windows
  const s = settingsStore.load();
  log.setDebug(!!s.debugLog);
  log.info('app', `Zion Bridge ${app.getVersion()} pornit`);

  // streamează logul către fereastră (pagina Diagnostic)
  log.setUiSink((entry) => { if (win && !win.isDestroyed()) win.webContents.send('log', entry); });

  // starea → UI + tray
  state.setOnChange((status) => {
    updateTray(status);
    if (win && !win.isDestroyed()) win.webContents.send('status', status);
  });

  registerIpc();
  initUpdater();
  createTray();
  createWindow();
  applyAutostart();
  state.syncPrinters(s.printers); // stațiile configurate apar din start în Status

  // pornește cele două module independente
  fiscal.init({ notify, journal: pushJournal });
  printjobs.init({ notify, journal: pushJournal });

  pushJournal('info', 'Zion Bridge a pornit. Aștept comenzi din cloud...');
}

app.on('window-all-closed', (e) => { /* nu ieșim — trăim în tray */ });
app.on('before-quit', () => { quitting = true; dude.shutdown(); });
