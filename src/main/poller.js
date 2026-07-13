// Buclă de polling robustă, reutilizată de modulul fiscal și de cel de imprimante.
//
//  - „in-flight guard": nu pornește un ciclu nou peste unul în lucru (dacă tipărirea
//    durează 12s, nu se suprapun cereri → fără bonuri duble);
//  - backoff exponențial cu jitter la erori (4s → 8 → 16 → max 30s), revine la
//    intervalul normal la primul succes;
//  - setTimeout re-armat (nu setInterval) → fără acumulare de ticks când PC-ul doarme.
'use strict';
const log = require('./logger');

function createPoller(name, taskFn, getBaseIntervalMs) {
  let timer = null;
  let running = false;   // ciclu în lucru
  let stopped = true;
  let failures = 0;

  function nextDelay() {
    const base = Math.max(1500, getBaseIntervalMs());
    if (failures === 0) return base;
    const backed = Math.min(30000, base * Math.pow(2, Math.min(failures, 4)));
    return backed + Math.floor(Math.random() * 1000); // jitter anti-sincronizare
  }

  async function tick() {
    if (stopped) return;
    if (running) { arm(1000); return; }
    running = true;
    try {
      await taskFn();
      if (failures > 0) log.info(name, 'Reconectat — reluăm ritmul normal');
      failures = 0;
    } catch (e) {
      failures++;
      log.debug(name, `Ciclu eșuat (${failures}): ${e.message}`);
    } finally {
      running = false;
      arm(nextDelay());
    }
  }

  function arm(ms) {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(tick, ms);
    if (timer.unref) { /* păstrăm referința — app desktop */ }
  }

  return {
    start() { if (!stopped) return; stopped = false; failures = 0; arm(50); },
    stop()  { stopped = true; clearTimeout(timer); },
    triggerNow() { if (!stopped && !running) { clearTimeout(timer); arm(10); } }
  };
}

module.exports = { createPoller };
