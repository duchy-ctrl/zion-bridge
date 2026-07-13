// Utilitare de text și numere pentru casă + imprimante.
'use strict';

// Diacriticele românești (inclusiv variantele cu sedilă vs virgulă) → ASCII.
// Casa Datecs și imprimantele pe codepage 437 nu le afișează corect.
const MAP = {
  'ă':'a','â':'a','î':'i','ș':'s','ş':'s','ț':'t','ţ':'t',
  'Ă':'A','Â':'A','Î':'I','Ș':'S','Ş':'S','Ț':'T','Ţ':'T',
  'é':'e','è':'e','ê':'e','ë':'e','á':'a','à':'a','ä':'a','ö':'o','ô':'o',
  'ü':'u','ù':'u','ú':'u','ç':'c','ñ':'n','É':'E','Á':'A','Ü':'U','Ö':'O'
};

function stripDiacritics(s) {
  if (s == null) return '';
  return String(s).replace(/[\u0080-\uFFFF]/g, ch => (MAP[ch] !== undefined ? MAP[ch] : '?'));
}

// Nume produs pentru casa fiscală: fără TAB, fără CR/LF, max 60 caractere.
function fiscalName(s) {
  return stripDiacritics(s).replace(/[\t\r\n]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, 60) || 'PRODUS';
}

// Text pentru imprimanta termică: fără caractere de control (păstrăm doar printabile ASCII).
function printText(s) {
  return stripDiacritics(s).replace(/[\x00-\x1F\x7F]/g, ' ');
}

// Preț / total: exact 2 zecimale, punct, fără separator de mii.
function money(x) {
  const n = Number(x);
  if (!isFinite(n)) return '0.00';
  return n.toFixed(2);
}

// Cantitate: exact 3 zecimale.
function qty3(x) {
  const n = Number(x);
  if (!isFinite(n) || n <= 0) return '1.000';
  return n.toFixed(3);
}

function fmtTime(ms) {
  const d = ms ? new Date(ms) : new Date();
  const p = n => String(n).padStart(2, '0');
  return { hm: `${p(d.getHours())}:${p(d.getMinutes())}`, dm: `${p(d.getDate())}.${p(d.getMonth() + 1)}` };
}

// Identificator de stație: „Bucătărie Caldă" → „bucatarie-calda".
// Folosit ca să potrivim job.station de la server cu imprimantele configurate local.
function slug(s) {
  return stripDiacritics(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'statie';
}

module.exports = { stripDiacritics, fiscalName, printText, money, qty3, fmtTime, slug };
