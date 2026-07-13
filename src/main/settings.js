// Settings store persistent (JSON în userData), cu valori implicite și scriere atomică.
'use strict';
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = {
  apiUrl: 'https://zion-pay.netlify.app/api/db',
  bridgeKey: '',
  pollIntervalMs: 4000,

  fiscal: {
    enabled: true,
    mode: 'tcp',            // 'tcp' | 'serial'
    ip: '192.168.0.71',
    port: 3999,
    com: 'COM3',
    baud: 115200,
    operator: 1,
    parola: '0001',
    amef: 1,
    tvaDefault: 1
  },

  // Listă DINAMICĂ de imprimante: cheia = identificatorul stației (slug),
  // valorile = etichetă vizibilă + IP/port pentru testul local.
  // Se pot adăuga oricâte stații din Setări (ex. „cocktail", „desert").
  printers: {
    bucatarie: { label: 'Bucătărie', ip: '192.168.0.50', port: 9100 },
    bar:       { label: 'Bar',       ip: '192.168.0.51', port: 9100 }
  },

  startAtLogin: true,
  startMinimized: true,
  debugLog: false,
  setupDone: false
};

let cache = null;
let filePath = null;

function deepMerge(base, extra) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  if (!extra || typeof extra !== 'object') return out;
  for (const k of Object.keys(extra)) {
    const v = extra[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') {
      out[k] = deepMerge(base[k], v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

function getPath() {
  if (!filePath) filePath = path.join(app.getPath('userData'), 'settings.json');
  return filePath;
}

function load() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(getPath(), 'utf8');
    const stored = JSON.parse(raw);
    cache = deepMerge(DEFAULTS, stored);
    // printers NU se amestecă cu valorile implicite: dacă utilizatorul a șters
    // o imprimantă, nu trebuie să reapară din DEFAULTS la următoarea pornire.
    if (stored.printers && typeof stored.printers === 'object') {
      cache.printers = JSON.parse(JSON.stringify(stored.printers));
    }
  } catch (_) {
    cache = deepMerge(DEFAULTS, {});
  }
  return cache;
}

function save(partial) {
  cache = deepMerge(load(), partial || {});
  // aceeași regulă: lista de imprimante se înlocuiește integral, nu se combină
  if (partial && partial.printers && typeof partial.printers === 'object') {
    cache.printers = JSON.parse(JSON.stringify(partial.printers));
  }
  const p = getPath();
  const tmp = p + '.tmp';
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf8');
    fs.renameSync(tmp, p); // scriere atomică: nu corupe fișierul dacă pică curentul
  } catch (e) {
    try { fs.writeFileSync(p, JSON.stringify(cache, null, 2), 'utf8'); } catch (_) {}
  }
  return cache;
}

module.exports = { load, save, DEFAULTS };
