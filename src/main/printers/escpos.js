// Constructor de bonuri ESC/POS pentru imprimantele termice de bar/bucătărie.
'use strict';
const { printText, fmtTime, money } = require('../text');

const ESC = 0x1B, GS = 0x1D;

function bytes(...arrs) {
  return Buffer.concat(arrs.map(a => Buffer.isBuffer(a) ? a : Buffer.from(a)));
}
function txt(s) {
  // după stripDiacritics totul e ASCII → sigur pe orice codepage (437/852)
  return Buffer.from(printText(s), 'latin1');
}
function line(s = '') { return bytes(txt(s), [0x0A]); }

const INIT        = Buffer.from([ESC, 0x40]);          // ESC @
const ALIGN_C     = Buffer.from([ESC, 0x61, 1]);       // ESC a 1
const ALIGN_L     = Buffer.from([ESC, 0x61, 0]);       // ESC a 0
const DOUBLE_ON   = Buffer.from([GS, 0x21, 0x11]);     // GS ! 0x11 (dublu L+H)
const DOUBLE_OFF  = Buffer.from([GS, 0x21, 0x00]);
const BOLD_ON     = Buffer.from([ESC, 0x45, 1]);
const BOLD_OFF    = Buffer.from([ESC, 0x45, 0]);
const CUT         = Buffer.from([GS, 0x56, 66, 0]);    // GS V 66 0 — tăiere parțială
const SEP = '--------------------------------';

/**
 * Construiește bonul de comandă pentru o secție.
 * job: { station, masa, by, at, barman?, items: [{nume, qty, note}] }
 * `barman` apare doar pe bonurile de bauturi (repartizare round-robin) — server-ul îl pune doar acolo.
 */
function buildTicket(job) {
  const t = fmtTime(job.at);
  const parts = [
    INIT,
    ALIGN_C, DOUBLE_ON,
    line(String(job.station || '').toUpperCase()),
    DOUBLE_OFF, ALIGN_L,
    line(),
    line(`Masa: ${job.masa || '-'}`),
    line(`Ora:  ${t.hm}  ${t.dm}`),
    line(`Ospatar: ${job.by || '-'}`)
  ];
  if (job.barman) parts.push(BOLD_ON, line(`Barman: ${job.barman}`), BOLD_OFF);
  parts.push(line(SEP));
  for (const it of (job.items || [])) {
    const q = Number(it.qty) || 1;
    parts.push(BOLD_ON, line(`${q} x  ${it.nume || ''}`), BOLD_OFF);
    if (it.note) parts.push(line(`    >> ${it.note}`));
  }
  parts.push(line(SEP), line(), line(), line(), CUT);
  return bytes(...parts);
}

/**
 * Construiește NOTA INFORMATIVĂ (proformă / pre-bon) — NU este bon fiscal.
 * job: { masa, by, at, items: [{nume, qty, pret}], total }
 */
function buildNota(job) {
  const t = fmtTime(job.at);
  const W = 32; // lățimea hârtiei în caractere
  // o linie cu „qty x nume" la stânga și prețul la dreapta, aliniat pe W coloane
  const itemLine = (left, right) => {
    let l = String(left || '');
    const r = String(right || '');
    const max = W - r.length - 1;        // lasă min 1 spațiu între text și preț
    if (l.length > max) l = l.slice(0, Math.max(0, max));
    const pad = Math.max(1, W - l.length - r.length);
    return line(l + ' '.repeat(pad) + r);
  };
  const parts = [
    INIT,
    ALIGN_C, DOUBLE_ON,
    line('ZION GARDENS'),
    DOUBLE_OFF,
    BOLD_ON, line('NOTA INFORMATIVA'), BOLD_OFF,
    line('** NU ESTE BON FISCAL **'),
    ALIGN_L, line(),
    line(`Masa: ${job.masa || '-'}`),
    line(`Ora:  ${t.hm}  ${t.dm}`),
    line(`Ospatar: ${job.by || '-'}`),
    line(SEP)
  ];
  for (const it of (job.items || [])) {
    const q = Number(it.qty) || 1;
    const pret = Number(it.pret) || 0;
    parts.push(itemLine(`${q} x ${it.nume || ''}`, money(q * pret)));
  }
  parts.push(line(SEP));
  // bacșiș separat (dacă aplicația l-a trimis): Subtotal / Bacsis / TOTAL DE PLATA
  const tip = Number(job.tip) || 0;
  if (tip > 0) {
    const subtotal = (job.subtotal != null) ? Number(job.subtotal) : (Number(job.total) - tip);
    parts.push(
      itemLine('Subtotal:', money(subtotal)),
      itemLine('Bacsis:', money(tip)),
      BOLD_ON, itemLine('TOTAL DE PLATA:', `${money(job.total)} lei`), BOLD_OFF
    );
  } else {
    parts.push(BOLD_ON, itemLine('TOTAL:', `${money(job.total)} lei`), BOLD_OFF);
  }
  parts.push(
    line(),
    ALIGN_C,
    line('Acesta nu este bon fiscal.'),
    line('Va multumim!'),
    line(), line(), CUT
  );
  return bytes(...parts);
}

/** Bon de test pentru butonul din Setări. */
function buildTestTicket(stationLabel) {
  return buildTicket({
    station: stationLabel,
    masa: 'TEST',
    by: 'Zion Bridge',
    at: Date.now(),
    items: [{ nume: 'Test imprimanta', qty: 1, note: 'daca citesti asta, merge :)' }]
  });
}

/**
 * Bon STORNO (anulare produse) — pentru bucătărie/bar, vizibil, ca personalul să vadă ce iese din comandă.
 * job: { masa, by, reason, at, items:[{nume, qty}] }
 */
function buildStorno(job) {
  const t = fmtTime(job.at);
  const parts = [
    INIT,
    ALIGN_C, DOUBLE_ON,
    line('** STORNO **'),
    DOUBLE_OFF,
    BOLD_ON, line('ANULARE PRODUSE'), BOLD_OFF,
    ALIGN_L, line(),
    line(`Masa: ${job.masa || '-'}`),
    line(`Ora:  ${t.hm}  ${t.dm}`),
    line(`Anulat de: ${job.by || '-'}`)
  ];
  if (job.reason) parts.push(line(`Motiv: ${job.reason}`));
  parts.push(line(SEP));
  for (const it of (job.items || [])) {
    const q = Number(it.qty) || 1;
    parts.push(BOLD_ON, line(`${q} x  ${it.nume || ''}`), BOLD_OFF);
  }
  parts.push(line(SEP), ALIGN_C, line('Scoateti din comanda!'), line(), line(), line(), CUT);
  return bytes(...parts);
}

module.exports = { buildTicket, buildNota, buildStorno, buildTestTicket };
