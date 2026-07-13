// Trimitere TCP raw către imprimanta termică (port 9100).
//
// Probleme de rețea tratate:
//  - timeout de conectare 4s (imprimantă oprită / IP greșit nu blochează podul);
//  - timeout total 10s (imprimantă „agățată" cu portul deschis dar care nu consumă);
//  - așteptăm golirea bufferului + un mic răgaz înainte de FIN — unele imprimante
//    aruncă restul jobului dacă închizi socketul imediat după write();
//  - mesaje de eroare clare pe românește pentru fiecare cod (ECONNREFUSED etc.).
'use strict';
const net = require('net');

const CONNECT_TIMEOUT_MS = 4000;
const TOTAL_TIMEOUT_MS = 10000;
const DRAIN_GRACE_MS = 400;

function friendly(err, ip, port) {
  const code = err && err.code;
  switch (code) {
    case 'ECONNREFUSED': return `Imprimanta ${ip}:${port} refuză conexiunea (port greșit sau serviciul RAW oprit)`;
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':  return `Imprimanta ${ip} nu e accesibilă în rețea (oprita? alt subnet? cablu?)`;
    case 'ETIMEDOUT':    return `Imprimanta ${ip}:${port} nu răspunde (timeout)`;
    case 'EHOSTDOWN':    return `Imprimanta ${ip} pare oprită`;
    case 'EADDRNOTAVAIL':
    case 'ENOTFOUND':    return `Adresa ${ip} este invalidă`;
    default: return `Eroare imprimantă ${ip}:${port}: ${err && err.message ? err.message : 'necunoscută'}`;
  }
}

/**
 * Trimite bytes la ip:port. Promite că se termină în max ~10s, oricum ar fi.
 */
function sendRaw(ip, port, buffer) {
  return new Promise((resolve, reject) => {
    if (!ip || !net.isIP(ip)) return reject(new Error(`IP imprimantă invalid: „${ip}"`));
    const p = Number(port) || 9100;

    const sock = new net.Socket();
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      clearTimeout(totalTimer);
      sock.removeAllListeners();
      try { sock.destroy(); } catch (_) {}
      err ? reject(err) : resolve();
    };

    const totalTimer = setTimeout(() => finish(new Error(`Imprimanta ${ip}:${p} a blocat transferul (timeout total 10s)`)), TOTAL_TIMEOUT_MS);

    sock.setNoDelay(true);
    sock.setTimeout(CONNECT_TIMEOUT_MS, () => finish(new Error(`Imprimanta ${ip}:${p} nu răspunde (timeout conectare 4s)`)));
    sock.once('error', (e) => finish(new Error(friendly(e, ip, p))));

    sock.connect(p, ip, () => {
      sock.setTimeout(0); // conectat; de aici contează doar timeoutul total
      sock.write(buffer, (err) => {
        if (err) return finish(new Error(friendly(err, ip, p)));
        // lăsăm imprimanta să consume bufferul, apoi închidem politicos
        setTimeout(() => {
          sock.end();
          // unele imprimante nu trimit FIN înapoi — nu așteptăm 'close' la nesfârșit
          setTimeout(() => finish(), 250);
        }, DRAIN_GRACE_MS);
      });
    });
  });
}

module.exports = { sendRaw };
