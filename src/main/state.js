// Starea globală (cloud / fiscal / imprimante) + memorie persistentă anti-duplicare.
//
// De ce există dedup persistat pe disc:
//  - Regula de aur a API-ului: fără Ack, jobul rămâne pending și se reia.
//  - Dacă bonul S-A tipărit dar Ack-ul a picat (net căzut fix atunci) sau aplicația
//    a fost închisă între tipărire și Ack, la repornire serverul retrimite jobul.
//    Fără memoria asta, bonul ar ieși de două ori. Cu ea: nu retipărim, doar re-trimitem Ack.
'use strict';
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const log = require('./logger');

const PRUNE_MS = 48 * 3600 * 1000; // ținem ID-urile procesate 48h

const status = {
  cloud:  { ok: false, lastSync: 0, error: 'Pornire...' },
  fiscal: { ok: false, enabled: true, paused: false, error: '', bonsToday: 0, lastBon: '' },
  prints: { today: 0 }, // bonuri de comandă tipărite azi (contor persistent)
  printers: {} // populat dinamic din setări + stațiile văzute în joburi
};

let onChange = null; // notifică main -> renderer + tray

function notify() { if (onChange) { try { onChange(getStatus()); } catch (_) {} } }

function setCloud(ok, error) {
  status.cloud.ok = ok;
  status.cloud.error = error || '';
  if (ok) status.cloud.lastSync = Date.now();
  notify();
}
function setFiscal(patch) { Object.assign(status.fiscal, patch); notify(); }
function setPrinter(stationKey, patch) {
  if (!status.printers[stationKey]) status.printers[stationKey] = { label: stationKey, ok: null, error: '', lastTs: 0 };
  Object.assign(status.printers[stationKey], patch);
  notify();
}

// Aliniază lista de stații din status cu setările (la pornire și după salvare):
// adaugă stațiile noi, șterge ce nu mai există, păstrează starea celor rămase.
function syncPrinters(printersCfg) {
  const cfg = printersCfg || {};
  for (const [key, p] of Object.entries(cfg)) {
    if (!status.printers[key]) status.printers[key] = { label: p.label || key, ok: null, error: '', lastTs: 0 };
    else status.printers[key].label = p.label || key;
  }
  for (const key of Object.keys(status.printers)) {
    // stațiile neconfigurate dispar doar dacă nu au activitate recentă (jobul
    // poate veni de la server pentru o stație configurată doar în aplicația web)
    if (!cfg[key] && Date.now() - (status.printers[key].lastTs || 0) > 3600 * 1000) {
      delete status.printers[key];
    }
  }
  notify();
}
function getStatus() { return JSON.parse(JSON.stringify(status)); }

// ---------- persistență (dedup + ack-uri restante + contor bonuri) ----------
let storePath = null;
let store = null; // { processed: {id:{t,kind}}, pendingAcks: [..], bons: {date, count} }

function getStorePath() {
  if (!storePath) storePath = path.join(app.getPath('userData'), 'runtime-store.json');
  return storePath;
}

function loadStore() {
  if (store) return store;
  try {
    store = JSON.parse(fs.readFileSync(getStorePath(), 'utf8'));
  } catch (_) {
    store = {};
  }
  if (!store.processed) store.processed = {};
  if (!Array.isArray(store.pendingAcks)) store.pendingAcks = [];
  if (!store.bons) store.bons = { date: today(), count: 0 };
  if (!store.prints) store.prints = { date: today(), count: 0 };
  prune();
  // contoarele pe ziua curentă
  if (store.bons.date !== today()) store.bons = { date: today(), count: 0 };
  if (store.prints.date !== today()) store.prints = { date: today(), count: 0 };
  status.fiscal.bonsToday = store.bons.count;
  status.prints.today = store.prints.count;
  return store;
}

function saveStore() {
  try {
    const p = getStorePath();
    fs.writeFileSync(p + '.tmp', JSON.stringify(store), 'utf8');
    fs.renameSync(p + '.tmp', p);
  } catch (e) {
    log.warn('store', 'Nu am putut salva runtime-store: ' + e.message);
  }
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function prune() {
  const now = Date.now();
  let n = 0;
  for (const id of Object.keys(store.processed)) {
    if (now - (store.processed[id].t || 0) > PRUNE_MS) { delete store.processed[id]; n++; }
  }
  if (n) log.debug('store', `Curățat ${n} ID-uri vechi din memoria anti-duplicare`);
}

function wasProcessed(id) { loadStore(); return !!store.processed[id]; }
function getProcessed(id) { loadStore(); return store.processed[id] || null; }

function markProcessed(id, kind) {
  loadStore();
  store.processed[id] = { t: Date.now(), kind };
  prune();
  saveStore();
}

// Ack-uri care nu au ajuns la server (net picat) — se reîncearcă la fiecare poll.
function queueAck(payload) {
  loadStore();
  // nu duplica același ack
  const key = JSON.stringify([payload.action, payload.orderId || payload.id]);
  if (!store.pendingAcks.some(a => JSON.stringify([a.action, a.orderId || a.id]) === key)) {
    store.pendingAcks.push(payload);
  }
  saveStore();
}
function pendingAcks() { loadStore(); return store.pendingAcks.slice(); }
function removeAck(payload) {
  loadStore();
  const key = JSON.stringify([payload.action, payload.orderId || payload.id]);
  store.pendingAcks = store.pendingAcks.filter(a => JSON.stringify([a.action, a.orderId || a.id]) !== key);
  saveStore();
}

function bumpPrintCount() {
  loadStore();
  if (store.prints.date !== today()) store.prints = { date: today(), count: 0 };
  store.prints.count++;
  saveStore();
  status.prints.today = store.prints.count;
  notify();
}

function bumpBonCount(nrbon) {
  loadStore();
  if (store.bons.date !== today()) store.bons = { date: today(), count: 0 };
  store.bons.count++;
  saveStore();
  setFiscal({ bonsToday: store.bons.count, lastBon: nrbon || '' });
}

module.exports = {
  setCloud, setFiscal, setPrinter, syncPrinters, getStatus,
  setOnChange: (fn) => { onChange = fn; },
  wasProcessed, getProcessed, markProcessed,
  queueAck, pendingAcks, removeAck,
  bumpBonCount, bumpPrintCount
};
