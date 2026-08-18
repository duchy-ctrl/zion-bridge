// Modulul FISCAL — bonuri fiscale pe casa Datecs prin DUDE.
//
// Reguli respectate (lecții din producție):
//  - Ack SE TRIMITE MEREU (reușit sau eșuat); dacă Ack-ul pică, e salvat pe disc și
//    reîncercat — iar comanda e marcată „procesată" ca să NU se tipărească de două ori;
//  - parolă greșită → modulul se PUNE PE PAUZĂ (casa blochează operatorul ~1 min după
//    încercări repetate; nu testăm parole în buclă) — utilizatorul corectează în Setări;
//  - orice eroare la mijlocul bonului → comanda 60 (anulare bon deschis), apoi ack:false;
//  - conexiunea se deschide per lot și se închide imediat (portul casei = un singur client);
//  - deconectare detectată → mesaj explicit „alt program ține portul casei?".
'use strict';
const log = require('../logger');
const state = require('../state');
const settingsStore = require('../settings');
const { api } = require('../cloud');
const { createPoller } = require('../poller');
const dude = require('./dude');
const { fiscalName, money, qty3 } = require('../text');

let notifyFn = null;   // toast Windows la eșec
let journalFn = null;  // intrare în jurnalul live

// ---------- interpretarea răspunsului casei ----------
// last_AnswerList: linii CRLF, câmpuri separate prin TAB; primul câmp = cod eroare (0 = ok)
function parseAnswer(answer) {
  const firstLine = String(answer || '').split(/\r?\n/)[0] || '';
  const fields = firstLine.split('\t');
  const code = parseInt(fields[0], 10);
  return { code: isNaN(code) ? null : code, fields };
}

function describeError(code, lastError, errMsg, status) {
  const c = code !== null ? code : lastError;
  let base;
  if (c === -112001) base = 'Eroare -112001: sintaxă invalidă a comenzii (parametri greșiți)';
  else if (c === undefined || c === null) base = 'Răspuns gol de la casă';
  else base = `Casa a răspuns cu eroarea ${c}`;
  const parts = [base];
  // mesajul text al casei (din driver) + biții de stare activi — fac eroarea lizibilă
  if (errMsg && String(errMsg).trim()) parts.push(`„${String(errMsg).trim()}"`);
  if (status && String(status).trim()) parts.push(`stare casă: ${String(status).trim()}`);
  return parts.join(' · ');
}

function looksLikeWrongPassword(answer, err) {
  const s = (String(answer || '') + ' ' + String(err || '')).toLowerCase();
  return s.includes('wrong password') || s.includes('parola') && s.includes('gresit');
}

// Rapoartele (69/94/95) tipăresc MULT — un Z cu o zi plină trece lejer de 25s. Timeout-ul scurt
// e pentru bonuri; pe rapoarte așteptăm până la 2 minute înainte să declarăm casa blocată.
const REPORT_EXEC_TIMEOUT_MS = 120000;

// execută o comandă și aruncă dacă a eșuat
async function step(num, params, what, timeoutMs) {
  const r = await dude.exec(num, params, timeoutMs);
  if (!r.ok) throw new Error(`${what}: ${r.err || 'eroare worker'}`);
  const { code, fields } = parseAnswer(r.answer);
  log.debug('fiscal', `cmd ${num} → rc=${r.rc} code=${code} msg="${r.errMsg || ''}" status="${r.status || ''}"`, r.answer ? String(r.answer).slice(0, 200) : '');
  if ((r.rc !== null && r.rc < 0) || (code !== null && code !== 0)) {
    const e = new Error(`${what}: ${describeError(code, r.lastError, r.errMsg, r.status)}`);
    e.answer = r.answer;
    e.code = code;
    throw e;
  }
  return { fields, answer: r.answer };
}

// ---------- tipărirea unui bon fiscal ----------
// Mutex la nivel de BON: butonul „Test bon fiscal" și bucla de polling nu au voie
// să-și intercaleze comenzile pe aceeași conexiune cu casa.
let receiptChain = Promise.resolve();
function printReceipt(order) {
  const p = receiptChain.then(() => doPrintReceipt(order));
  receiptChain = p.catch(() => {});
  return p;
}

async function doPrintReceipt(order) {
  const s = settingsStore.load().fiscal;
  let opened = false;
  try {
    let o;
    try { o = await dude.open(s); }
    catch (e) { e.connection = true; throw e; }   // timeout / worker mort la open = casa nu răspunde → bonul rămâne în coadă și se reia singur
    if (!o.ok) {
      const err = new Error(o.err || 'Nu mă pot conecta la casă');
      err.connection = true;
      throw err;
    }
    opened = true;

    // 48 — deschide bon
    try {
      await step(48, `${s.operator}\t${s.parola}\t${s.amef}\t`, 'Deschidere bon');
    } catch (e) {
      if (looksLikeWrongPassword(e.answer, e.message)) {
        e.wrongPassword = true; // tratat special mai sus — pauză modul
      }
      throw e;
    }

    // 49 — vinde fiecare produs
    for (const it of (order.items || [])) {
      const nume = fiscalName(it.nume);
      const tva = (it.tva === null || it.tva === undefined) ? s.tvaDefault : it.tva;
      await step(49, `${nume}\t${tva}\t${money(it.pret)}\t${qty3(it.qty)}\t\t\t0\t0\t`, `Produs „${nume}"`);
    }

    // 51 — discount pe subtotal, doar dacă există
    const disc = Number(order.discount) || 0;
    if (disc > 0) {
      await step(51, `1\t0\t2\t${money(disc)}\t`, 'Discount');
    }

    // 49b — BACȘIȘ pe card: linie separată în grupa TVA D (= 4).
    // Aplicația trimite bacșișul ca un câmp SEPARAT (`tip`) — NU e inclus în order.total
    // (acela e doar marfa). Deci îl tipărim ca articol ȘI îl adunăm la plată (53):
    // card = marfă + bacșiș. Grupa: din comandă (setarea aplicației) sau local, implicit 4 (D).
    const bacsis = Number(order.BACSIS ?? order.bacsis ?? order.tip ?? order.bacsisCard ?? order.cardTip) || 0;
    if (bacsis > 0) {
      const grupaBacsis = Number(order.bacsisTva) || Number(s.bacsisTva) || 4; // grupa D = 4
      await step(49, `${fiscalName('Bacsis')}\t${grupaBacsis}\t${money(bacsis)}\t${qty3(1)}\t\t\t0\t0\t`, 'Bacșiș');
    }

    // 53 — plată/total (0 = numerar, 1 = card); cardul = marfă + bacșiș
    const mix = order.payMix && Number(order.payMix.cash) > 0 && Number(order.payMix.card) > 0 ? order.payMix : null;
    if (mix) {
      // PLATĂ MIXTĂ pe același bon: întâi porția cash (tip 0), apoi restul pe card + bacșiș (tip 1).
      // Casa acumulează plățile; suma lor = order.total + bacșiș = totalul bonului (marfă + articolul Bacsis).
      const cashPart = Math.round(Number(mix.cash) * 100) / 100;
      const cardPart = Math.round((Number(mix.card) + bacsis) * 100) / 100;
      await step(53, `0\t${money(cashPart)}\t`, `Plată numerar ${money(cashPart)}`);
      await step(53, `1\t${money(cardPart)}\t`, `Plată card ${money(cardPart)}`);
    } else {
      const payType = String(order.plata).toLowerCase() === 'card' ? 1 : 0;
      await step(53, `${payType}\t${money(Math.round((Number(order.total) + bacsis) * 100) / 100)}\t`, 'Plată');
    }

    // 56 — închide bonul; al doilea câmp din răspuns = numărul bonului
    const fin = await step(56, '', 'Închidere bon');
    const nrbon = (fin.fields[1] || '').trim() ||
                  (String(fin.answer || '').split(/\r?\n/)[1] || '').split('\t')[0].trim() || '';
    return nrbon;

  } catch (e) {
    // recuperare: anulăm bonul rămas deschis ca să nu blocheze casa
    if (opened && !e.connection) {
      try { await dude.exec(60, ''); log.warn('fiscal', 'Bon anulat (cmd 60) după eroare'); }
      catch (_) { log.warn('fiscal', 'Nu am putut anula bonul (cmd 60)'); }
    }
    throw e;
  } finally {
    if (opened) await dude.close(); // eliberăm portul casei imediat
  }
}

// ---------- CHEIA DE CONTROL: contorul Z din memoria fiscală ----------
// Citire READ-ONLY (nu tipărește nimic): FP-700, cmd 64 (0x40) = informații despre ultima
// înregistrare din memoria fiscală; câmpul 1 din răspuns = NUMĂRUL ultimei înregistrări,
// adică al ultimului Z. E sursa de adevăr când noi și casa nu mai suntem de acord.
// Dacă modelul răspunde altfel, comanda/parametrii se ajustează FĂRĂ rebuild, din settings.json:
// fiscal.zCntCmd (implicit 64) / fiscal.zCntParams (implicit '').
// ATENȚIE (audit 18.08): comanda aleasă TREBUIE să întoarcă un contor CRESCĂTOR în câmpul 1 —
// verificarea de mai jos e „zAfter > zBefore". NU folosi cmd 68 (înregistrări LIBERE, scade la
// fiecare Z): cu el, orice Z reușit după timeout ar părea „nemișcat" → reluare → DUBLU Z.
async function readZCounter() {
  const s = settingsStore.load().fiscal;
  const num = Number(s.zCntCmd) || 64;
  const params = (s.zCntParams === undefined || s.zCntParams === null) ? '' : String(s.zCntParams);
  try {
    const r = await dude.exec(num, params);
    if (!r.ok) return null;
    const { code, fields } = parseAnswer(r.answer);
    if ((r.rc !== null && r.rc < 0) || (code !== null && code !== 0)) {
      log.warn('fiscal', `Contorul Z nu se poate citi (cmd ${num} → code=${code}, rc=${r.rc}) — răspuns: ${String(r.answer||'').slice(0,120)}`);
      return null;
    }
    const n = parseInt(String(fields[1] || '').replace(/\D/g, ''), 10);
    if (!Number.isFinite(n) || n <= 0) { log.warn('fiscal', `Contorul Z: răspuns neinterpretabil: ${String(r.answer||'').slice(0,120)}`); return null; }
    return n;
  } catch (_) { return null; }
}

// ---------- rapoarte X / Z (cerute din aplicația web, prin cloud) ----------
// cmd 69 = raport zilnic: parametru "0" = Z (închide ziua fiscală), "2" = X (informativ).
// Folosește ACELAȘI mutex ca bonurile — nu se intercalează cu un bon în lucru.
// Întoarce { text, nrZ, verificat } — nrZ = contorul Z al casei (cheia de control către zion-suite).
async function doRunReport(tip) {
  const s = settingsStore.load().fiscal;
  let opened = false;
  try {
    let o;
    try { o = await dude.open(s); }
    catch (e) { e.connection = true; throw e; }   // timeout / worker mort la open = casa nu răspunde → raportul rămâne în coadă și se reia singur
    if (!o.ok) { const err = new Error(o.err || 'Nu mă pot conecta la casă'); err.connection = true; throw err; }
    opened = true;
    // cheia de control se citește ÎNAINTE: dacă exec-ul dă timeout, comparația before/after decide adevărul
    const zBefore = tip === 'z' ? await readZCounter() : null;
    let fin;
    try {
      // Datecs cmd 69 (raport zilnic): parametrul 1 este LITERA tipului de raport,
      // nu o cifră — 'Z' = raport Z (închide ziua), 'X' = raport X (informativ).
      fin = await step(69, tip === 'z' ? 'Z' : 'X', tip === 'z' ? 'Raport Z' : 'Raport X', REPORT_EXEC_TIMEOUT_MS);
    } catch (e) {
      if (!e.timeout) throw e;
      // TIMEOUT la exec: workerul COM a fost omorât, dar CASA poate să fi terminat raportul
      // (incidentul din 18.08: Z-ul a ieșit pe hârtie, aplicația a arătat „eroare"). NU ghicim:
      // reconectăm și ÎNTREBĂM casa — contorul Z e cheia de control.
      opened = false;
      try { await dude.close(); } catch (_) {}
      await new Promise(r => setTimeout(r, 5000));   // lăsăm casa să termine de tipărit
      try { const o2 = await dude.open(s); if (o2 && o2.ok) opened = true; } catch (_) {}
      let zAfter = (opened && tip === 'z') ? await readZCounter() : null;
      // AUDIT 18.08 (🟡1): casa scrie înregistrarea Z în memoria fiscală abia la FINALUL tipăririi.
      // Un „nemișcat" imediat poate însemna doar „încă tipărește" — recitim o dată după 30s înainte
      // să declarăm reluarea sigură. Abia un contor nemișcat DE DOUĂ ORI înseamnă „Z-ul nu s-a făcut".
      if (tip === 'z' && zBefore !== null && zAfter !== null && zAfter <= zBefore) {
        log.warn('fiscal', `Contorul Z pare nemișcat (#${zBefore}) — mai aștept 30s și recitesc (poate casa încă tipărește).`);
        await new Promise(r => setTimeout(r, 30000));
        const z2 = await readZCounter();
        if (z2 !== null) zAfter = z2;
      }
      if (tip === 'z' && zBefore !== null && zAfter !== null) {
        if (zAfter > zBefore) {
          log.warn('fiscal', `Timeout la Z, dar contorul Z a crescut (${zBefore} → ${zAfter}) — raportul E FĂCUT, îl confirm.`);
          return { text: `Z confirmat prin contorul casei după timeout (Z #${zAfter})`, nrZ: zAfter, verificat: true };
        }
        // contorul NEMIȘCAT și după recitire = Z-ul chiar nu s-a făcut → reluarea e SIGURĂ (rămâne în coadă)
        const err = new Error(`Timeout la Z, iar contorul Z al casei NU a crescut (rămas la #${zBefore}, verificat de două ori) — se reia automat.`);
        err.connection = true; throw err;
      }
      if (tip !== 'z') {
        // X e informativ — retipărirea nu strică nimic → rămâne în coadă și se reia
        const err = new Error('Timeout la raportul X — se reia automat.');
        err.connection = true; throw err;
      }
      // Z fără verificare posibilă (contorul nu se poate citi) → NU riscăm un al doilea Z:
      // eroare EXPLICITĂ, omul se uită pe hârtie înainte să mai ceară unul.
      throw new Error(`Timeout la Z și nu am putut citi contorul Z al casei — VERIFICĂ PE HÂRTIE dacă Z-ul a ieșit înainte să mai ceri unul. (${e.message})`);
    }
    const nrZ = tip === 'z' ? await readZCounter() : null;
    const text = String(fin.answer || (fin.fields||[]).join(' ') || '').replace(/\s+/g,' ').trim().slice(0,1500);
    return { text, nrZ, verificat: tip === 'z' && zBefore !== null && nrZ !== null && nrZ > zBefore };
  } finally {
    if (opened) await dude.close(); // eliberăm portul casei imediat
  }
}
function runReport(tip) {
  const p = receiptChain.then(() => doRunReport(tip));
  receiptChain = p.catch(() => {});
  return p;
}

// ---------- raport fiscal pe perioadă (din memoria fiscală, între 2 date) ----------
// READ-ONLY: doar tipărește din memorie, NU închide ziua. Același mutex ca bonurile.
async function doRunPeriodReport(from, to) {
  const s = settingsStore.load().fiscal;
  let opened = false;
  try {
    let o;
    try { o = await dude.open(s); }
    catch (e) { e.connection = true; throw e; }   // timeout / worker mort la open = casa nu răspunde → raportul rămâne în coadă și se reia singur
    if (!o.ok) { const err = new Error(o.err || 'Nu mă pot conecta la casă'); err.connection = true; throw err; }
    opened = true;
    // FP-700: raport memorie fiscală pe dată = cmd 94 (0x5E).
    // Format params (TAB-separated): <tip>\t<DD-MM-YY start>\t<DD-MM-YY end>\t  — tip '0' = detaliat.
    // FP-700 cere data în format DD-MM-YY (cu liniuțe), conform manualului (DDMMYY dă „-112102 param 2").
    // Alternative dacă mai refuză: tip '1', an pe 4 cifre 'DD-MM-YYYY', sau cmd 95 (raport pe nr. Z).
    const dmy = d => { const [Y,M,D] = String(d).split('-'); return `${D}-${M}-${Y.slice(2)}`; };
    let fin;
    try { fin = await step(94, `0\t${dmy(from)}\t${dmy(to)}\t`, `Raport perioadă ${from}..${to}`, REPORT_EXEC_TIMEOUT_MS); }
    catch (e) { if (e.timeout) e.connection = true; throw e; }   // READ-ONLY: retipărirea nu strică → rămâne în coadă
    return String(fin.answer || (fin.fields||[]).join(' ') || '').replace(/\s+/g,' ').trim().slice(0,1500);
  } finally {
    if (opened) await dude.close();
  }
}
function runPeriodReport(from, to) {
  const p = receiptChain.then(() => doRunPeriodReport(from, to));
  receiptChain = p.catch(() => {});
  return p;
}

// ---------- raport din memoria fiscală pe NUMĂR de Z (între nr. Z) ----------
// READ-ONLY (cmd 95). `from`/`to` = numerele Z (ex. 51..55), trimise ca atare din aplicație
// (deci formatul lor se poate ajusta din app fără rebuild de pod). Pt un singur Z: from=to.
async function doRunZNumberReport(from, to) {
  const s = settingsStore.load().fiscal;
  let opened = false;
  try {
    let o;
    try { o = await dude.open(s); }
    catch (e) { e.connection = true; throw e; }   // timeout / worker mort la open = casa nu răspunde → raportul rămâne în coadă și se reia singur
    if (!o.ok) { const err = new Error(o.err || 'Nu mă pot conecta la casă'); err.connection = true; throw err; }
    opened = true;
    // FP-700: raport memorie fiscală pe interval de numere Z = cmd 95 (0x5F).
    // Params (TAB): <tip>\t<nr Z start>\t<nr Z end>\t  — tip '0' = SUMAR, tip '1' = DETALIAT.
    // (tip '0' dădea „SUMAR DIN MF"; pt detaliat = '1'. Dacă '1' nu e detaliat, încearcă '2'.)
    let fin;
    try { fin = await step(95, `1\t${from}\t${to}\t`, `Raport Z detaliat #${from}..${to}`, REPORT_EXEC_TIMEOUT_MS); }
    catch (e) { if (e.timeout) e.connection = true; throw e; }   // READ-ONLY: retipărirea nu strică → rămâne în coadă
    return String(fin.answer || (fin.fields||[]).join(' ') || '').replace(/\s+/g,' ').trim().slice(0,1500);
  } finally {
    if (opened) await dude.close();
  }
}
function runZNumberReport(from, to) {
  const p = receiptChain.then(() => doRunZNumberReport(from, to));
  receiptChain = p.catch(() => {});
  return p;
}

// ---------- Ack cu plasă de siguranță ----------
async function sendAck(payload) {
  try {
    await api('fiscalAck', payload);
    state.removeAck({ action: 'fiscalAck', ...payload });
  } catch (e) {
    log.warn('fiscal', `Ack pentru ${payload.orderId} nu a ajuns (${e.message}) — salvat, se reîncearcă`);
    state.queueAck({ action: 'fiscalAck', ...payload });
  }
}
async function sendReportAck(payload) {
  try {
    await api('fiscalReportAck', payload);
    state.removeAck({ action: 'fiscalReportAck', ...payload });
  } catch (e) {
    log.warn('fiscal', `Ack raport ${payload.id} nu a ajuns (${e.message}) — salvat, se reîncearcă`);
    state.queueAck({ action: 'fiscalReportAck', ...payload });
  }
}

async function flushPendingAcks() {
  for (const a of state.pendingAcks().filter(x => x.action === 'fiscalAck' || x.action === 'fiscalReportAck')) {
    const { action, ...payload } = a;
    try {
      await api(action, payload);
      state.removeAck(a);
      log.info('fiscal', `Ack restant livrat pentru ${payload.orderId || payload.id}`);
    } catch (_) { break; } // netul tot picat — încercăm la următorul poll
  }
}

// ---------- bucla principală ----------
async function cycle() {
  const s = settingsStore.load();
  if (!s.fiscal.enabled) { state.setFiscal({ ok: false, enabled: false, error: 'Modul dezactivat' }); return; }
  const fiscalState = state.getStatus().fiscal;
  if (fiscalState.paused) return; // parolă greșită — așteptăm intervenția omului

  await flushPendingAcks();

  let res;
  try {
    res = await api('fiscalQueue');
    state.setCloud(true);
  } catch (e) {
    state.setCloud(false, e.message);
    throw e; // poller-ul face backoff
  }

  const orders = Array.isArray(res.orders) ? res.orders : [];
  const reports = Array.isArray(res.reports) ? res.reports : [];
  if (!orders.length && !reports.length) {
    // nimic de făcut: nu atingem starea casei (rămâne ultima cunoscută)
    return;
  }

  for (const order of orders) {
    if (!order || !order.id) continue;

    // ANTI-DUPLICARE: deja procesată (ex. Ack pierdut) → doar ack, fără retipărire.
    // Răspundem cu rezultatul REAL de atunci (ok/eșuat), nu mereu ok.
    const prev = state.getProcessed(order.id);
    if (prev) {
      const wasOk = prev.kind === 'fiscal';
      log.warn('fiscal', `Comanda ${order.id} deja procesată (${prev.kind}) — retrimit doar Ack (fără bon dublu)`);
      await sendAck({ orderId: order.id, ok: wasOk, nrbon: '', err: wasOk ? '' : 'eșuat anterior (vezi jurnalul podului)' });
      continue;
    }

    try {
      const nrbon = await printReceipt(order);
      state.markProcessed(order.id, 'fiscal');           // ÎNTÂI marcăm, apoi ack
      await sendAck({ orderId: order.id, ok: true, nrbon, err: '' });
      state.bumpBonCount(nrbon);
      state.setFiscal({ ok: true, error: '' });
      log.ok('fiscal', `Bon fiscal #${nrbon || '?'} · ${order.masa || ''} · ${money(order.total)} lei ✓`);
      if (journalFn) journalFn('ok', `Bon fiscal #${nrbon || '?'} · ${order.masa || ''} · ${money(order.total)} lei`);
    } catch (e) {
      const msg = e.message || 'Eroare necunoscută';
      log.error('fiscal', `Bon EȘUAT pentru ${order.masa || order.id}: ${msg}`);
      if (journalFn) journalFn('err', `Bon fiscal EȘUAT · ${order.masa || ''} · ${msg}`);

      if (e.wrongPassword) {
        state.setFiscal({ ok: false, paused: true, error: 'Parolă operator GREȘITĂ — modul pus pe pauză. Corectează în Setări. (Casa blochează operatorul după încercări repetate!)' });
        if (notifyFn) notifyFn('Casă fiscală: parolă greșită', 'Modulul fiscal e pe pauză. Corectează parola în Setări.');
        // NU trimitem ack:false — comanda rămâne în coadă și va fi tipărită după corectare.
        break;
      }

      if (e.connection) {
        state.setFiscal({ ok: false, error: msg });
        if (notifyFn) notifyFn('Casa fiscală nu răspunde', msg);
        // Conexiune picată: NU dăm ack — reîncercăm la următorul ciclu (bonul nu s-a tipărit).
        break;
      }

      // Eroare de tipărire reală (produs invalid etc.): ack negativ ca să apară în app,
      // și marcăm procesată ca să nu reîncercăm la nesfârșit același bon defect.
      state.markProcessed(order.id, 'fiscal-failed');
      await sendAck({ orderId: order.id, ok: false, nrbon: '', err: msg.slice(0, 200) });
      state.setFiscal({ ok: false, error: msg });
      if (notifyFn) notifyFn('Bon fiscal eșuat', `${order.masa || order.id}: ${msg}`);
    }
  }

  // ---- rapoarte X / Z cerute din aplicația web ----
  for (const rep of reports) {
    if (!rep || !rep.id) continue;
    const tip = rep.tip === 'z' ? 'z' : rep.tip === 'periodic' ? 'periodic' : rep.tip === 'znumar' ? 'znumar' : 'x';

    // anti-duplicare: un raport Z dat de două ori = două zile fiscale închise!
    const prev = state.getProcessed(rep.id);
    if (prev) {
      const wasOk = prev.kind === 'report';
      log.warn('fiscal', `Raportul ${rep.id} deja procesat (${prev.kind}) — retrimit doar Ack`);
      await sendReportAck({ id: rep.id, ok: wasOk, result: '', err: wasOk ? '' : 'eșuat anterior (vezi jurnalul podului)' });
      continue;
    }

    try {
      const out = tip === 'periodic' ? await runPeriodReport(rep.from, rep.to)
        : tip === 'znumar' ? await runZNumberReport(rep.from, rep.to)
        : await runReport(tip);
      // runReport întoarce { text, nrZ, verificat } (cheia de control); celelalte întorc string
      const r = (out && typeof out === 'object') ? out : { text: out || '', nrZ: null, verificat: false };
      state.markProcessed(rep.id, 'report');             // ÎNTÂI marcăm, apoi ack
      await sendReportAck({ id: rep.id, ok: true, result: r.text || '', err: '',
        ...(r.nrZ ? { nrZ: r.nrZ, verificat: !!r.verificat } : {}) });
      state.setFiscal({ ok: true, error: '' });
      log.ok('fiscal', `Raport ${tip.toUpperCase()} executat pe casă ✓${r.nrZ ? ` · Z #${r.nrZ}` : ''}`);
      if (journalFn) journalFn('ok', `Raport ${tip.toUpperCase()} executat pe casă${r.nrZ ? ` · Z #${r.nrZ}` : ''}`);
    } catch (e) {
      const msg = e.message || 'Eroare necunoscută';
      if (e.connection) {
        // casa nu răspunde: NU dăm ack — raportul rămâne în coadă și se reia
        state.setFiscal({ ok: false, error: msg });
        if (notifyFn) notifyFn('Casa fiscală nu răspunde', msg);
        break;
      }
      state.markProcessed(rep.id, 'report-failed');
      await sendReportAck({ id: rep.id, ok: false, result: '', err: msg.slice(0, 200) });
      log.error('fiscal', `Raport ${tip.toUpperCase()} EȘUAT: ${msg}`);
      if (journalFn) journalFn('err', `Raport ${tip.toUpperCase()} EȘUAT · ${msg}`);
      if (notifyFn) notifyFn(`Raport ${tip.toUpperCase()} eșuat`, msg);
    }
  }
}

let poller = null;
function init({ notify, journal }) {
  notifyFn = notify;
  journalFn = journal;
  poller = createPoller('fiscal', cycle, () => settingsStore.load().pollIntervalMs);
  poller.start();
}

function resume() { state.setFiscal({ paused: false, error: '' }); if (poller) poller.triggerNow(); }

// Test din Setări: bon real cu un produs de 0.01 lei? Nu — bon de test cu produsul „TEST".
async function testReceipt() {
  const order = {
    id: 'test-' + Date.now(),
    masa: 'TEST', discount: 0, plata: 'cash', total: 0.01,
    items: [{ nume: 'TEST ZION BRIDGE', qty: 1, pret: 0.01, tva: null }]
  };
  const nrbon = await printReceipt(order);
  state.bumpBonCount(nrbon);
  state.setFiscal({ ok: true, error: '' });
  return nrbon;
}

async function testConnection() {
  const s = settingsStore.load().fiscal;
  const det = await dude.detect();
  if (!det.ok) throw new Error(det.err);
  const o = await dude.open(s);
  if (!o.ok) throw new Error(o.err);
  await dude.close();
  return true;
}

module.exports = { init, resume, testReceipt, testConnection };
