// Punte Node ↔ worker PowerShell (COM DUDE).
//
// Probleme tratate:
//  - worker mort/crăpat → repornit automat la următoarea cerere;
//  - timeout per cerere (25s) → o casă blocată nu îngheață aplicația;
//  - serializare: O SINGURĂ comandă în zbor (COM-ul DUDE nu e thread-safe);
//  - scriptul .ps1 e copiat din pachetul asar pe disc la pornire (PowerShell nu
//    poate citi din arhiva asar);
//  - procesul e pornit complet ascuns (fără fereastră neagră).
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const log = require('../logger');

const REQ_TIMEOUT_MS = 25000;

let proc = null;
let buf = '';
let nextId = 1;
const waiting = new Map(); // id -> {resolve, reject, timer}
let chain = Promise.resolve(); // serializare cereri

function workerScriptPath() {
  // copiem scriptul în userData (sandbox asar nu e accesibil pentru PowerShell)
  const target = path.join(app.getPath('userData'), 'dude-worker.ps1');
  const src = path.join(__dirname, 'dude-worker.ps1');
  try {
    // BOM obligatoriu: PowerShell 5.1 interpretează fișierele fără BOM ca ANSI
    let content = fs.readFileSync(src, 'utf8');
    if (!content.startsWith('﻿')) content = '﻿' + content;
    let existing = null;
    try { existing = fs.readFileSync(target, 'utf8'); } catch (_) {}
    if (existing !== content) fs.writeFileSync(target, content, 'utf8');
  } catch (e) {
    log.error('dude', 'Nu pot pregăti scriptul worker: ' + e.message);
    throw e;
  }
  return target;
}

function ensureWorker() {
  if (proc && !proc.killed && proc.exitCode === null) return;
  const script = workerScriptPath();
  log.debug('dude', 'Pornesc workerul PowerShell COM');
  proc = spawn('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-WindowStyle', 'Hidden', '-File', script
  ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });

  buf = '';
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', chunk => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch (_) { log.debug('dude', 'Linie non-JSON de la worker: ' + line.slice(0, 200)); continue; }
      const w = waiting.get(msg.id);
      if (w) {
        clearTimeout(w.timer);
        waiting.delete(msg.id);
        w.resolve(msg);
      }
    }
  });
  proc.stderr.setEncoding('utf8');
  proc.stderr.on('data', d => log.debug('dude', 'worker stderr: ' + String(d).slice(0, 300)));

  proc.on('exit', (code) => {
    log.warn('dude', `Workerul PowerShell s-a oprit (cod ${code}) — va fi repornit la nevoie`);
    for (const [, w] of waiting) {
      clearTimeout(w.timer);
      w.reject(new Error('Workerul COM s-a oprit neașteptat'));
    }
    waiting.clear();
    proc = null;
  });
  proc.on('error', (e) => {
    log.error('dude', 'Nu pot porni powershell.exe: ' + e.message);
    proc = null;
  });
}

function rawSend(cmd, args) {
  return new Promise((resolve, reject) => {
    try { ensureWorker(); } catch (e) { return reject(e); }
    if (!proc) return reject(new Error('Workerul COM nu a putut porni (powershell.exe indisponibil?)'));
    const id = nextId++;
    const payload = JSON.stringify({ id, cmd, ...args }) + '\n';
    const timer = setTimeout(() => {
      waiting.delete(id);
      // worker blocat (casă care nu răspunde la nivel COM) → îl omorâm ca să nu rămână zombi
      try { proc.kill(); } catch (_) {}
      reject(new Error(`Timeout (${REQ_TIMEOUT_MS / 1000}s) la comanda '${cmd}' către casă — conexiunea pare blocată`));
    }, REQ_TIMEOUT_MS);
    waiting.set(id, { resolve, reject, timer });
    proc.stdin.write(payload, 'utf8', (err) => {
      if (err) {
        clearTimeout(timer);
        waiting.delete(id);
        reject(new Error('Nu pot scrie către workerul COM: ' + err.message));
      }
    });
  });
}

// Toate cererile trec printr-un lanț — niciodată două comenzi simultan către casă.
function send(cmd, args = {}) {
  const p = chain.then(() => rawSend(cmd, args));
  chain = p.catch(() => {}); // erorile nu blochează lanțul
  return p;
}

async function detect() { return send('detect'); }
async function open(cfg) {
  if (cfg.mode === 'serial') return send('open', { mode: 'serial', com: cfg.com, baud: cfg.baud });
  return send('open', { mode: 'tcp', ip: cfg.ip, port: cfg.port });
}
async function exec(num, params) { return send('exec', { num, params }); }
async function close() { try { return await send('close'); } catch (e) { return { ok: false, err: e.message }; } }

function shutdown() {
  if (proc) {
    try { proc.stdin.end(); } catch (_) {}
    const p = proc;
    setTimeout(() => { try { p.kill(); } catch (_) {} }, 1500);
    proc = null;
  }
}

module.exports = { detect, open, exec, close, shutdown };
