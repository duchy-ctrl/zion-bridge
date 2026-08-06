// Modulul IMPRIMANTE — bonuri de comandă (printQueue → ESC/POS → TCP → printAck).
//
// Aceeași disciplină ca la fiscal:
//  - Ack mereu (ok sau eșuat); Ack pierdut → salvat pe disc, reîncercat;
//  - job tipărit dar ne-Ack-uit → la repornire NU se retipărește (anti-dublare);
//  - imprimantă picată → ack:false cu motivul (serverul decide reluarea), starea
//    apare clar în fereastră + notificare.
'use strict';
const log = require('../logger');
const state = require('../state');
const settingsStore = require('../settings');
const { api } = require('../cloud');
const { createPoller } = require('../poller');
const { buildTicket, buildNota, buildStorno, buildTestTicket } = require('./escpos');
const { sendRaw } = require('./printer');
const { slug } = require('../text');

let notifyFn = null;
let journalFn = null;

// Potrivește stația din job cu imprimantele configurate local:
//  1) după cheie (slug identic), 2) după eticheta vizibilă,
//  3) stație necunoscută → cheie nouă dinamică (jobul vine oricum cu IP rezolvat
//     de server, deci se tipărește; doar apare ca stație nouă în Status).
function stationKey(st) {
  const s = slug(st);
  const printers = settingsStore.load().printers || {};
  if (printers[s]) return s;
  for (const [k, v] of Object.entries(printers)) {
    if (slug(v.label || k) === s) return k;
  }
  return s;
}

async function sendAck(payload) {
  try {
    await api('printAck', payload);
    state.removeAck({ action: 'printAck', ...payload });
  } catch (e) {
    log.warn('print', `Ack pentru ${payload.id} nu a ajuns (${e.message}) — salvat, se reîncearcă`);
    state.queueAck({ action: 'printAck', ...payload });
  }
}

async function flushPendingAcks() {
  for (const a of state.pendingAcks().filter(x => x.action === 'printAck')) {
    const { action, ...payload } = a;
    try {
      await api('printAck', payload);
      state.removeAck(a);
      log.info('print', `Ack restant livrat pentru ${payload.id}`);
    } catch (_) { break; }
  }
}

async function cycle() {
  await flushPendingAcks();

  let res;
  try {
    res = await api('printQueue');
    state.setCloud(true);
  } catch (e) {
    state.setCloud(false, e.message);
    throw e;
  }

  const jobs = Array.isArray(res.jobs) ? res.jobs : [];
  for (const job of jobs) {
    if (!job || !job.id) continue;
    const key = stationKey(job.station);

    const prev = state.getProcessed(job.id);
    if (prev) {
      const wasOk = prev.kind === 'print';
      log.warn('print', `Jobul ${job.id} deja procesat (${prev.kind}) — retrimit doar Ack (fără bon dublu)`);
      await sendAck({ id: job.id, ok: wasOk, err: wasOk ? '' : 'eșuat anterior (vezi jurnalul podului)' });
      continue;
    }

    // IP/port vin rezolvate în job de la server; fallback pe setările locale
    const local = (settingsStore.load().printers || {})[key] || {};
    const label = local.label || job.station || key;
    const ip = job.ip || local.ip;
    const port = job.port || local.port || 9100;

    try {
      if (!ip) throw new Error(`Lipsește IP-ul imprimantei pentru secția „${job.station}"`);
      await sendRaw(ip, port, job.type === 'storno' ? buildStorno(job) : job.type === 'nota' ? buildNota(job) : buildTicket(job));
      state.markProcessed(job.id, 'print');
      await sendAck({ id: job.id, ok: true, err: '' });
      state.setPrinter(key, { label, ok: true, error: '', lastTs: Date.now() });
      state.bumpPrintCount();
      log.ok('print', `Comandă ${label} · ${job.masa || ''} ✓`);
      if (journalFn) journalFn('ok', `Comandă ${label} · ${job.masa || ''}`);
    } catch (e) {
      const msg = e.message || 'eroare necunoscută';
      // Tipărirea a eșuat clar (nimic nu a ieșit) → ack:false; serverul poate replanifica.
      state.markProcessed(job.id, 'print-failed');
      await sendAck({ id: job.id, ok: false, err: msg.slice(0, 200) });
      state.setPrinter(key, { label, ok: false, error: msg, lastTs: Date.now() });
      log.error('print', `Comandă ${label} EȘUATĂ · ${job.masa || ''}: ${msg}`);
      if (journalFn) journalFn('err', `Comandă ${label} EȘUATĂ · ${job.masa || ''} · ${msg}`);
      if (notifyFn) notifyFn(`Imprimanta ${label} a eșuat`, msg);
    }
  }
}

let poller = null;
function init({ notify, journal }) {
  notifyFn = notify;
  journalFn = journal;
  poller = createPoller('print', cycle, () => settingsStore.load().pollIntervalMs);
  poller.start();
}

/** Test local din Setări — nu trece prin cloud. Funcționează pentru orice stație configurată. */
async function testPrinter(key) {
  const cfg = (settingsStore.load().printers || {})[key];
  if (!cfg) throw new Error(`Stația „${key}" nu există în setări`);
  if (!cfg.ip) throw new Error(`Setează întâi IP-ul imprimantei „${cfg.label || key}"`);
  await sendRaw(cfg.ip, cfg.port || 9100, buildTestTicket((cfg.label || key).toUpperCase()));
  state.setPrinter(key, { ok: true, error: '', lastTs: Date.now() });
  return true;
}

module.exports = { init, testPrinter };
