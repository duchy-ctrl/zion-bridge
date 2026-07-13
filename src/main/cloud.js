// Client API către Zion Suite (cloud) — un singur endpoint, POST JSON.
//
// Probleme de rețea tratate aici:
//  - timeout dur (8s) cu AbortController: un server care „atârnă" nu blochează podul;
//  - DNS/net picat: eroare clară, fără excepții nehandle-uite;
//  - răspuns non-200 sau non-JSON (ex: pagină de eroare Netlify): detectat și raportat;
//  - backoff exponențial cu jitter în bucla de polling (vezi poller.js) ca să nu
//    bombardăm serverul când e căzut.
'use strict';
const log = require('./logger');
const settings = require('./settings');

const REQ_TIMEOUT_MS = 8000;

function friendlyNetError(e) {
  const m = String((e && e.message) || e);
  if (/abort/i.test(m)) return 'Timeout — serverul nu a răspuns în 8s';
  if (/ENOTFOUND|EAI_AGAIN/i.test(m)) return 'DNS eșuat — verifică conexiunea la internet';
  if (/ECONNREFUSED/i.test(m)) return 'Conexiune refuzată de server';
  if (/ECONNRESET/i.test(m)) return 'Conexiune întreruptă (reset)';
  if (/ETIMEDOUT/i.test(m)) return 'Timeout de rețea';
  if (/certificate|SSL|TLS/i.test(m)) return 'Problemă certificat SSL — verifică data/ora PC-ului';
  if (/fetch failed/i.test(m)) return 'Rețea indisponibilă (fetch failed)';
  return m;
}

/**
 * Trimite o acțiune la API. Aruncă Error cu mesaj prietenos dacă pică.
 * @param {string} action  fiscalQueue | fiscalAck | printQueue | printAck
 * @param {object} extra   câmpuri suplimentare
 */
async function api(action, extra = {}) {
  const s = settings.load();
  const body = { action, ...extra };
  if (s.bridgeKey) body.key = s.bridgeKey;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  try {
    log.debug('cloud', `→ ${action}`, extra && Object.keys(extra).length ? extra : undefined);
    const res = await fetch(s.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    const text = await res.text();
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new Error(`Cheie BRIDGE_KEY respinsă de server (HTTP ${res.status}) — verifică Setări`);
      }
      throw new Error(`Server HTTP ${res.status}: ${text.slice(0, 120)}`);
    }
    let json;
    try { json = text ? JSON.parse(text) : {}; }
    catch (_) { throw new Error('Răspuns invalid de la server (nu e JSON): ' + text.slice(0, 120)); }
    log.debug('cloud', `← ${action} ok`, json);
    return json;
  } catch (e) {
    throw new Error(friendlyNetError(e));
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { api };
