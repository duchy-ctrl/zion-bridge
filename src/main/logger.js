// Logger cu fișiere rotative + jurnal live trimis către interfață.
'use strict';
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB / fișier
const MAX_FILES = 5;
const RING_SIZE = 500;

let dir = null;
let debugEnabled = false;
let uiSink = null;            // funcție(entry) -> trimite la renderer
const ring = [];              // ultimele intrări pentru jurnalul live

function logsDir() {
  if (!dir) {
    dir = path.join(app.getPath('userData'), 'logs');
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  }
  return dir;
}

function currentFile() { return path.join(logsDir(), 'bridge.log'); }

function rotateIfNeeded() {
  try {
    const f = currentFile();
    const st = fs.existsSync(f) ? fs.statSync(f) : null;
    if (st && st.size > MAX_FILE_BYTES) {
      for (let i = MAX_FILES - 1; i >= 1; i--) {
        const a = path.join(logsDir(), `bridge.${i}.log`);
        const b = path.join(logsDir(), `bridge.${i + 1}.log`);
        if (fs.existsSync(a)) { try { fs.renameSync(a, b); } catch (_) {} }
      }
      try { fs.renameSync(f, path.join(logsDir(), 'bridge.1.log')); } catch (_) {}
    }
  } catch (_) {}
}

function ts() {
  const d = new Date();
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

function write(level, mod, msg, extra) {
  const entry = { t: Date.now(), level, mod, msg: String(msg) };
  if (extra !== undefined) {
    try { entry.extra = typeof extra === 'string' ? extra : JSON.stringify(extra); } catch (_) {}
  }
  // fișier
  try {
    rotateIfNeeded();
    const line = `${ts()} [${level.toUpperCase()}] [${mod}] ${entry.msg}${entry.extra ? ' | ' + entry.extra : ''}\n`;
    fs.appendFileSync(currentFile(), line, 'utf8');
  } catch (_) {}
  // jurnal live (debug doar dacă e activat)
  if (level !== 'debug' || debugEnabled) {
    ring.push(entry);
    if (ring.length > RING_SIZE) ring.shift();
    if (uiSink) { try { uiSink(entry); } catch (_) {} }
  }
}

module.exports = {
  info:  (mod, msg, extra) => write('info', mod, msg, extra),
  warn:  (mod, msg, extra) => write('warn', mod, msg, extra),
  error: (mod, msg, extra) => write('error', mod, msg, extra),
  ok:    (mod, msg, extra) => write('ok', mod, msg, extra),
  debug: (mod, msg, extra) => { if (debugEnabled) write('debug', mod, msg, extra); },
  setDebug: (v) => { debugEnabled = !!v; },
  isDebug: () => debugEnabled,
  setUiSink: (fn) => { uiSink = fn; },
  recent: () => ring.slice(),
  logsDir
};
