'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bridge', {
  getStatus:    () => ipcRenderer.invoke('get-status'),
  getSettings:  () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),
  getJournal:   () => ipcRenderer.invoke('get-journal'),
  getLog:       () => ipcRenderer.invoke('get-log'),
  testFiscal:     () => ipcRenderer.invoke('test-fiscal'),
  testFiscalConn: () => ipcRenderer.invoke('test-fiscal-conn'),
  testPrinter:  (key) => ipcRenderer.invoke('test-printer', key),
  detectDude:   () => ipcRenderer.invoke('detect-dude'),
  scanNetwork:  (port) => ipcRenderer.invoke('scan-network', port),
  resumeFiscal: () => ipcRenderer.invoke('resume-fiscal'),
  openLogs:     () => ipcRenderer.invoke('open-logs'),
  appVersion:   () => ipcRenderer.invoke('app-version'),

  onStatus:  (fn) => ipcRenderer.on('status', (_e, s) => fn(s)),
  onJournal: (fn) => ipcRenderer.on('journal', (_e, j) => fn(j)),
  onLog:     (fn) => ipcRenderer.on('log', (_e, l) => fn(l)),
  onScanProgress: (fn) => ipcRenderer.on('scan-progress', (_e, p) => fn(p))
});
