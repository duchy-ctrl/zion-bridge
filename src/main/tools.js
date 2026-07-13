// Unelte de diagnostic: detectare DUDE în registru + scanare rețea pentru casă/imprimante.
'use strict';
const net = require('net');
const os = require('os');
const { execFile } = require('child_process');
const log = require('./logger');

/** Caută în registru ProgID-uri care conțin „dude" (ex. dude.CFD_DUDE). */
function detectDude() {
  return new Promise((resolve) => {
    const ps = `
      $found = @()
      foreach ($pid_ in @('dude.CFD_DUDE')) {
        if ([type]::GetTypeFromProgID($pid_)) { $found += $pid_ }
      }
      if (-not $found.Count) {
        try {
          $keys = Get-ChildItem 'Registry::HKEY_CLASSES_ROOT' -ErrorAction SilentlyContinue |
                  Where-Object { $_.PSChildName -match 'dude' } | Select-Object -First 5
          foreach ($k in $keys) { $found += $k.PSChildName }
        } catch {}
      }
      $found -join ','
    `;
    execFile('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps],
      { windowsHide: true, timeout: 20000 },
      (err, stdout) => {
        const list = String(stdout || '').trim().split(',').filter(Boolean);
        if (err && !list.length) {
          log.debug('tools', 'detectDude eroare: ' + err.message);
          return resolve({ found: false, progIds: [] });
        }
        resolve({ found: list.length > 0, progIds: list });
      });
  });
}

/** Subnetul local /24 dedus din interfețele active (ex. „192.168.0"). */
function localSubnets() {
  const subs = new Set();
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const i of ifs[name] || []) {
      if (i.family === 'IPv4' && !i.internal) {
        subs.add(i.address.split('.').slice(0, 3).join('.'));
      }
    }
  }
  return [...subs];
}

function probe(ip, port, timeoutMs) {
  return new Promise((resolve) => {
    const s = new net.Socket();
    let ok = false;
    s.setTimeout(timeoutMs);
    s.once('connect', () => { ok = true; s.destroy(); });
    s.once('timeout', () => s.destroy());
    s.once('error', () => {});
    s.once('close', () => resolve(ok ? ip : null));
    s.connect(port, ip);
  });
}

/**
 * Scanează subnetul /24 după un port deschis (3999 = casă Datecs, 9100 = imprimante).
 * Concurență limitată (48) ca să nu sufoce rețeaua sau Windows-ul.
 */
async function scanPort(port, onProgress) {
  const subs = localSubnets();
  if (!subs.length) throw new Error('Nu am găsit nicio interfață de rețea activă');
  const targets = [];
  for (const sub of subs) for (let h = 1; h <= 254; h++) targets.push(`${sub}.${h}`);

  const found = [];
  const CONC = 48;
  let idx = 0, done = 0;
  async function workerLoop() {
    while (idx < targets.length) {
      const ip = targets[idx++];
      const hit = await probe(ip, port, 350);
      done++;
      if (hit) found.push(hit);
      if (onProgress && done % 32 === 0) onProgress(Math.round(done / targets.length * 100));
    }
  }
  await Promise.all(Array.from({ length: CONC }, workerLoop));
  log.info('tools', `Scanare port ${port}: ${found.length} dispozitive găsite (${subs.join(', ')}.x)`);
  return found.sort();
}

module.exports = { detectDude, scanPort, localSubnets };
