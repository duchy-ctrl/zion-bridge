'use strict';
const $ = (sel) => document.querySelector(sel);

/* ---------- tabs ---------- */
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    $('#tab-' + btn.dataset.tab).classList.add('active');
  });
});

/* ---------- helpers ---------- */
function fmtTime(t) {
  const d = new Date(t);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function setResult(el, text, ok) {
  el.textContent = text;
  el.className = 'result ' + (ok === true ? 'ok' : ok === false ? 'err' : '');
}
async function withBusy(btn, resultEl, fn) {
  btn.disabled = true;
  try { await fn(); }
  catch (e) { setResult(resultEl, '✗ ' + (e.message || e).replace(/^Error invoking remote method '[^']+': Error: /, ''), false); }
  finally { btn.disabled = false; }
}

/* ---------- status live ---------- */
let lastStatus = null;
function renderStatus(s) {
  lastStatus = s;
  // cloud
  const cloudOk = !!s.cloud.ok;
  $('#dot-cloud').className = 'dot ' + (cloudOk ? 'ok' : 'err');
  $('#cloud-main').textContent = cloudOk ? 'Conectat' : 'Deconectat';
  refreshCloudSub();

  // fiscal
  const df = $('#dot-fiscal');
  const f = s.fiscal;
  let fiscalState = 'off'; // off | ok | warn | err
  if (!f.enabled) { df.className = 'dot'; $('#fiscal-main').textContent = 'Dezactivată'; $('#fiscal-sub').textContent = ''; }
  else if (f.paused) { fiscalState = 'err'; df.className = 'dot err'; $('#fiscal-main').textContent = 'PE PAUZĂ'; $('#fiscal-sub').textContent = f.error; }
  else if (f.error && !f.ok) { fiscalState = 'err'; df.className = 'dot err'; $('#fiscal-main').textContent = 'Eroare'; $('#fiscal-sub').textContent = f.error; }
  else if (f.ok) { fiscalState = 'ok'; df.className = 'dot ok'; $('#fiscal-main').textContent = 'Funcțională'; $('#fiscal-sub').textContent = `Bonuri azi: ${f.bonsToday}` + (f.lastBon ? ` · ultimul #${f.lastBon}` : ''); }
  else { fiscalState = 'warn'; df.className = 'dot warn'; $('#fiscal-main').textContent = 'Așteptare prim bon'; $('#fiscal-sub').textContent = `Bonuri azi: ${f.bonsToday}`; }
  $('#btn-resume').classList.toggle('hidden', !f.paused);

  // imprimante — listă dinamică
  const list = $('#printer-status-list');
  list.textContent = '';
  const entries = Object.entries(s.printers);
  const errs = [];
  let anyErr = false, anyOk = false;
  if (!entries.length) {
    const p = document.createElement('p');
    p.className = 'big'; p.textContent = 'Nicio imprimantă configurată';
    list.appendChild(p);
  }
  for (const [key, p] of entries) {
    const line = document.createElement('div');
    line.className = 'pr-line';
    const mark = document.createElement('span');
    mark.className = 'pmark ' + (p.ok === true ? 'ok' : p.ok === false ? 'err' : 'idle');
    mark.textContent = p.ok === true ? '✓' : p.ok === false ? '✗' : '–';
    const name = document.createElement('span');
    name.textContent = p.label || key;
    line.appendChild(mark); line.appendChild(name);
    list.appendChild(line);
    if (p.ok === false) { anyErr = true; errs.push(`${p.label || key}: ${p.error}`); }
    if (p.ok === true) anyOk = true;
  }
  $('#printers-sub').textContent = errs.join(' · ');
  const printersState = anyErr ? 'err' : anyOk ? 'ok' : 'warn';
  $('#dot-printers').className = 'dot ' + printersState;

  // statistici
  $('#stat-bons').textContent = f.bonsToday ?? 0;
  $('#stat-prints').textContent = (s.prints && s.prints.today) || 0;

  // sidebar
  $('#side-cloud').className = 'dot ' + (cloudOk ? 'ok' : 'err');
  $('#side-fiscal').className = 'dot ' + (fiscalState === 'off' ? '' : fiscalState);
  $('#side-printers').className = 'dot ' + printersState;

  // hero (starea generală, dintr-o privire)
  const hero = $('#hero');
  if (!cloudOk) {
    hero.className = 'hero err';
    $('#hero-title').textContent = 'Fără conexiune la cloud';
    $('#hero-sub').textContent = s.cloud.error || 'verifică internetul pe acest PC';
  } else if (fiscalState === 'err') {
    hero.className = 'hero err';
    $('#hero-title').textContent = f.paused ? 'Modulul fiscal e pe pauză' : 'Problemă la casa fiscală';
    $('#hero-sub').textContent = f.error || 'vezi cardul „Casă fiscală"';
  } else if (anyErr) {
    hero.className = 'hero warn';
    $('#hero-title').textContent = 'O imprimantă are probleme';
    $('#hero-sub').textContent = errs.join(' · ').slice(0, 120);
  } else {
    hero.className = 'hero ok';
    $('#hero-title').textContent = 'Totul funcționează';
    $('#hero-sub').textContent = 'podul tipărește bonurile pe măsură ce vin';
  }
}
function refreshCloudSub() {
  if (!lastStatus) return;
  const c = lastStatus.cloud;
  const ago = c.lastSync ? Math.max(0, Math.round((Date.now() - c.lastSync) / 1000)) : null;
  $('#cloud-sub').textContent = c.ok
    ? (ago !== null ? `ultima sincronizare acum ${ago}s` : '')
    : (c.error || '');
  $('#stat-sync').textContent = ago !== null ? (ago < 60 ? `${ago}s` : `${Math.round(ago / 60)}m`) : '—';
}
setInterval(refreshCloudSub, 1000);

/* ---------- jurnal ---------- */
function addEntry(container, e, kindKey) {
  const div = document.createElement('div');
  div.className = 'j-entry';
  const kind = e[kindKey] || 'info';
  const map = { ok: 'j-ok', err: 'j-err', error: 'j-err', warn: 'j-warn', info: 'j-info', debug: 'j-info' };
  div.innerHTML = `<span class="j-time">${fmtTime(e.t)}</span><span class="${map[kind] || 'j-info'}"></span>`;
  div.lastChild.textContent = (e.mod ? `[${e.mod}] ` : '') + e.msg + (e.extra ? ' | ' + e.extra : '');
  const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 40;
  container.appendChild(div);
  while (container.children.length > 400) container.removeChild(container.firstChild);
  if (atBottom) container.scrollTop = container.scrollHeight;
}

/* ---------- imprimante dinamice (rânduri în Setări) ---------- */
function slugify(s) {
  const MAP = { 'ă':'a','â':'a','î':'i','ș':'s','ş':'s','ț':'t','ţ':'t' };
  return String(s || '').toLowerCase().replace(/[ăâîșşțţ]/g, c => MAP[c])
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function addPrinterRow(key, cfg = {}) {
  const listEl = $('#printer-list');
  const row = document.createElement('div');
  row.className = 'printer-row';
  row.innerHTML = `
    <label>Nume stație<input type="text" class="pr-label" placeholder="ex: bucatarie"></label>
    <label>IP<input type="text" class="pr-ip" placeholder="192.168.0.50"></label>
    <label>Port<input type="number" class="pr-port" placeholder="9100"></label>
    <button type="button" class="action pr-test">Test</button>
    <button type="button" class="action pr-del">Șterge</button>`;
  row.querySelector('.pr-label').value = cfg.label || key || '';
  row.querySelector('.pr-ip').value = cfg.ip || '';
  row.querySelector('.pr-port').value = cfg.port || 9100;
  row.querySelector('.pr-del').addEventListener('click', () => {
    if (confirm('Ștergi această imprimantă din pod? (configurarea din aplicația web rămâne neatinsă)')) row.remove();
  });
  row.querySelector('.pr-test').addEventListener('click', (e) => withBusy(e.target, $('#printer-tools-result'), async () => {
    const label = row.querySelector('.pr-label').value.trim();
    if (!label) throw new Error('Dă un nume stației înainte de test');
    setResult($('#printer-tools-result'), `Salvez setările și trimit bon de test la „${label}"...`);
    await window.bridge.saveSettings(readForm());
    await window.bridge.testPrinter(slugify(label));
    setResult($('#printer-tools-result'), `✓ Bonul de test a plecat spre „${label}"`, true);
  }));
  listEl.appendChild(row);
}

function readPrinters() {
  const printers = {};
  for (const row of document.querySelectorAll('.printer-row')) {
    const label = row.querySelector('.pr-label').value.trim();
    if (!label) continue; // rând gol — ignorat
    const key = slugify(label);
    printers[key] = {
      label,
      ip: row.querySelector('.pr-ip').value.trim(),
      port: Number(row.querySelector('.pr-port').value) || 9100
    };
  }
  return printers;
}

$('#btn-add-printer').addEventListener('click', () => addPrinterRow('', { port: 9100 }));

/* ---------- setări: form <-> model ---------- */
const form = $('#settings-form');
function fillForm(s) {
  form.apiUrl.value = s.apiUrl;
  form.bridgeKey.value = s.bridgeKey;
  form.pollSec.value = Math.round(s.pollIntervalMs / 1000);
  form.fiscalEnabled.checked = s.fiscal.enabled;
  form.fiscalMode.value = s.fiscal.mode;
  form.fiscalIp.value = s.fiscal.ip;
  form.fiscalPort.value = s.fiscal.port;
  form.fiscalCom.value = s.fiscal.com;
  form.fiscalBaud.value = s.fiscal.baud;
  form.fiscalOperator.value = s.fiscal.operator;
  form.fiscalParola.value = s.fiscal.parola;
  form.fiscalAmef.value = s.fiscal.amef;
  form.fiscalTva.value = s.fiscal.tvaDefault;
  $('#printer-list').textContent = '';
  for (const [key, cfg] of Object.entries(s.printers || {})) addPrinterRow(key, cfg);
  form.startAtLogin.checked = s.startAtLogin;
  form.startMinimized.checked = s.startMinimized;
  form.debugLog.checked = s.debugLog;
  toggleMode();
}
function readForm() {
  return {
    apiUrl: form.apiUrl.value.trim(),
    bridgeKey: form.bridgeKey.value.trim(),
    pollIntervalMs: Math.min(30, Math.max(2, Number(form.pollSec.value) || 4)) * 1000,
    fiscal: {
      enabled: form.fiscalEnabled.checked,
      mode: form.fiscalMode.value,
      ip: form.fiscalIp.value.trim(),
      port: Number(form.fiscalPort.value) || 3999,
      com: form.fiscalCom.value.trim() || 'COM3',
      baud: Number(form.fiscalBaud.value) || 115200,
      operator: Number(form.fiscalOperator.value) || 1,
      parola: form.fiscalParola.value.trim(),
      amef: Number(form.fiscalAmef.value) || 1,
      tvaDefault: Number(form.fiscalTva.value) || 1
    },
    printers: readPrinters(),
    startAtLogin: form.startAtLogin.checked,
    startMinimized: form.startMinimized.checked,
    debugLog: form.debugLog.checked,
    setupDone: true
  };
}
function toggleMode() {
  const serial = form.fiscalMode.value === 'serial';
  document.querySelectorAll('.tcp-only').forEach(el => el.classList.toggle('hidden', serial));
  document.querySelectorAll('.serial-only').forEach(el => el.classList.toggle('hidden', !serial));
}
form.fiscalMode.addEventListener('change', toggleMode);

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  // validări simple ca să prindem greșeli de tastare înainte să ajungă la casă
  const s = readForm();
  const ipRe = /^\d{1,3}(\.\d{1,3}){3}$/;
  if (!/^https?:\/\//.test(s.apiUrl)) return setResult($('#save-result'), '✗ URL-ul aplicației trebuie să înceapă cu https://', false);
  if (!s.bridgeKey) return setResult($('#save-result'), '✗ BRIDGE_KEY e obligatorie — serverul refuză podul fără ea (o setezi în Netlify → Environment variables)', false);
  if (s.fiscal.enabled && s.fiscal.mode === 'tcp' && !ipRe.test(s.fiscal.ip)) return setResult($('#save-result'), '✗ IP-ul casei nu arată a IP valid', false);
  if (s.fiscal.enabled && !/^\d{4,8}$/.test(s.fiscal.parola)) return setResult($('#save-result'), '✗ Parola operatorului trebuie să aibă 4–8 cifre', false);
  // imprimante: nume duplicate sau IP-uri greșite
  const seen = new Set();
  for (const row of document.querySelectorAll('.printer-row')) {
    const label = row.querySelector('.pr-label').value.trim();
    if (!label) continue;
    const k = slugify(label);
    if (seen.has(k)) return setResult($('#save-result'), `✗ Două imprimante au același nume: „${label}"`, false);
    seen.add(k);
    const ip = row.querySelector('.pr-ip').value.trim();
    if (ip && !ipRe.test(ip)) return setResult($('#save-result'), `✗ IP-ul imprimantei „${label}" nu arată a IP valid`, false);
  }
  await window.bridge.saveSettings(s);
  setResult($('#save-result'), '✓ Salvat. Setările se aplică imediat.', true);
  setTimeout(() => setResult($('#save-result'), ''), 4000);
});

/* ---------- butoane unelte ---------- */
$('#btn-resume').addEventListener('click', async () => { await window.bridge.resumeFiscal(); });

$('#btn-detect-dude').addEventListener('click', (e) => withBusy(e.target, $('#fiscal-tools-result'), async () => {
  setResult($('#fiscal-tools-result'), 'Caut DUDE în registru...');
  const r = await window.bridge.detectDude();
  setResult($('#fiscal-tools-result'),
    r.found ? `✓ DUDE găsit: ${r.progIds.join(', ')}` : '✗ DUDE nu pare instalat — instalează Datecs Universal Driver Engine',
    r.found);
}));

let activeScan = null; // un singur listener global, nu unul nou per click
window.bridge.onScanProgress(p => {
  if (activeScan) setResult(activeScan.el, `Scanez rețeaua pe portul ${activeScan.port}... ${p}%`);
});
function scanHandler(btn, port, resultEl) {
  return withBusy(btn, resultEl, async () => {
    setResult(resultEl, `Scanez rețeaua pe portul ${port}... 0%`);
    activeScan = { el: resultEl, port };
    try {
      const ips = await window.bridge.scanNetwork(port);
      setResult(resultEl, ips.length ? `✓ Găsit pe portul ${port}: ${ips.join(', ')}` : `✗ Nimic găsit pe portul ${port} în subnetul local`, ips.length > 0);
    } finally { activeScan = null; }
  });
}
$('#btn-scan-casa').addEventListener('click', (e) => scanHandler(e.target, 3999, $('#fiscal-tools-result')));
$('#btn-scan-pr').addEventListener('click', (e) => scanHandler(e.target, 9100, $('#printer-tools-result')));

$('#btn-test-conn').addEventListener('click', (e) => withBusy(e.target, $('#fiscal-tools-result'), async () => {
  setResult($('#fiscal-tools-result'), 'Salvez setările și testez conexiunea...');
  await window.bridge.saveSettings(readForm());
  await window.bridge.testFiscalConn();
  setResult($('#fiscal-tools-result'), '✓ Conexiunea cu casa funcționează', true);
}));

$('#btn-test-fiscal').addEventListener('click', async (e) => {
  if (!confirm('Atenție: testul scoate un BON FISCAL REAL de 0.01 lei pe casă. Continui?')) return;
  withBusy(e.target, $('#fiscal-tools-result'), async () => {
    setResult($('#fiscal-tools-result'), 'Tipăresc bonul de test...');
    await window.bridge.saveSettings(readForm());
    const nrbon = await window.bridge.testFiscal();
    setResult($('#fiscal-tools-result'), `✓ Bon de test tipărit — numărul ${nrbon || '(necitit)'}`, true);
  });
});

$('#btn-open-logs').addEventListener('click', () => window.bridge.openLogs());

/* ---------- inițializare ---------- */
(async function init() {
  const [status, settings, journal, logEntries, ver] = await Promise.all([
    window.bridge.getStatus(),
    window.bridge.getSettings(),
    window.bridge.getJournal(),
    window.bridge.getLog(),
    window.bridge.appVersion()
  ]);
  $('#version').textContent = 'v' + ver;
  renderStatus(status);
  fillForm(settings);
  const jEl = $('#journal'), dEl = $('#debuglog');
  journal.forEach(e => addEntry(jEl, e, 'kind'));
  logEntries.forEach(e => addEntry(dEl, e, 'level'));
  jEl.scrollTop = jEl.scrollHeight;
  dEl.scrollTop = dEl.scrollHeight;

  window.bridge.onStatus(renderStatus);
  window.bridge.onJournal(e => addEntry(jEl, e, 'kind'));
  window.bridge.onLog(e => addEntry(dEl, e, 'level'));

  // prima rulare → direct la Setări
  if (!settings.setupDone) document.querySelector('[data-tab="setari"]').click();
})();
