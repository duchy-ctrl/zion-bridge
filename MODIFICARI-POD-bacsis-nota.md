# Zion-Bridge (pod) — modificări aplicate (bacșiș + notă informativă + STORNO)

## Modificarea 4 (13.07.2026, v2.3.0) — bacșiș SEPARAT pe nota informativă + AUTO-UPDATE
- `buildNota` (escpos.js): dacă jobul are `tip>0` → tipărește Subtotal / Bacsis / **TOTAL DE PLATA**;
  fără tip → TOTAL simplu, ca înainte. Serverul trimite `subtotal`+`tip`+`total` (vezi `printNota` în db.mjs).
- Auto-update activat: `main.js` (initUpdater + tray „Verifică actualizări"/„Repornește și actualizează"),
  `package.json` (electron-updater, publish → genesysflow/zion-bridge, v2.3.0), build automat pe GitHub
  Actions (`.github/workflows/release.yml`) — vezi `AUTO-UPDATE-pod-GHID.md` pentru pașii de pornire.
- Backup: `escpos.js/main.js/package.json` cu sufixul `.20260713-171928.pre-*`. `node --check` curat.
- ⚠️ Reminder: dacă bacșișul nu iese pe bonul FISCAL la casă, podul instalat e mai vechi decât build-ul din
  23.06 (fixul de la Modificarea 1) — instalarea v2.3.0 rezolvă; verifică și grupa D programată pe Datecs.

**Acesta e folderul REAL/actualizat al podului** (lucrat direct pe PC-ul cu casa).
Modificările de mai jos sunt deja în cod — **trebuie doar `build.bat` + restart pod.**

## Modificarea 3 — bon STORNO la anulare (anti-fraudă)
Fișiere: `src/main/printers/escpos.js` (funcția `buildStorno`), `printjobs.js` (rutează `type:"storno"`).
- Când în aplicație se anulează un produs ȘI e bifat „Tipărește bon STORNO la secție" (Contabilitate →
  Anti-fraudă anulări), la bucătărie/bar iese un bon **„** STORNO ** / ANULARE PRODUSE"** cu masa, ora, cine a
  anulat, motivul și produsele scoase. Așa personalul vede ce iese din comandă (paper trail anti-fraudă).
- Joburile vechi (fără `type`) rămân pe `buildTicket`; `type:"nota"`→`buildNota`; `type:"storno"`→`buildStorno`.
- Backup: `escpos.js.pre-storno2`, `printjobs.js.pre-storno2`. `node --check` curat.

> ⚠️ Podul NU e în Git. `git pull` / deploy Docker actualizează doar aplicația web (serverul).
> Podul se reconstruiește separat, aici, pe acest PC.

---

## Ce s-a modificat acum

### 1. BACȘIȘ pe bonul fiscal — CORECȚIE importantă
Fișier: `src/main/fiscal/fiscal.js`.
- Exista deja o variantă de bacșiș (linie cmd 49 „Bacsis", grupa D=4), **dar avea o problemă**: la plată (cmd 53)
  trimitea doar `order.total`, presupunând că bacșișul e deja inclus în total. **NU este** — aplicația trimite
  `total` = doar marfa (după discount) și bacșișul SEPARAT (câmpul `tip`).
- Rezultatul vechi: suma articolelor (marfă + bacșiș) > plata (doar marfa) → casa refuza să închidă bonul.
- **Fix:** plata cmd 53 = `order.total + bacșiș`. Acum bonul e echilibrat: produse + linie „Bacsis" (grupa D) și
  CARD = marfă + bacșiș.
- Grupa bacșiș: `order.bacsisTva` (setarea din aplicație, implicit 4=D) → fallback local → 4.
- La cash/protocol sau card fără bacșiș: nicio linie, plata = total (neschimbat).
- **Rapoartele X/Z (cmd 69) și restul muncii tale — NEATINSE.**
- Backup: `src/main/fiscal/fiscal.js.bak-pre-fix-bacsis-nota`.

### 2. NOTĂ INFORMATIVĂ (proformă ne-fiscală)
Fișiere: `src/main/printers/escpos.js` (funcția nouă `buildNota`), `src/main/printers/printjobs.js` (rutare
`type:"nota"` → `buildNota`; comenzile de bucătărie/bar rămân pe `buildTicket`).
- Tipărește pe imprimanta Bar o proformă cu produse + prețuri + TOTAL, marcată „** NU ESTE BON FISCAL **".
- Backup: `escpos.js.bak-pre-nota`, `printjobs.js.bak-pre-nota`.

---

## De făcut pe acest PC
1. `build.bat`
2. Închide complet podul (tray → Exit) și pornește varianta reconstruită.
3. Verificare:
   - **Notă informativă:** masă cu produse → buton „📄 Notă informativă" → iese pe Bar cu prețuri + TOTAL.
   - **Bacșiș:** masă → card + bacșiș 5 pe 100 → bon fiscal: linie „Bacsis" grupa D = 5.00, CARD = 105.00.
   - **Comenzi normale + rapoarte X/Z:** ca înainte (non-regresie).

> Grupa D (4) trebuie să fie programată pe casa Datecs cu cota de bacșiș. La raportul Z, încasările includ bacșișul.

*Verificat: Audit GO + QA PASS, node --check curat pe fiscal.js / escpos.js / printjobs.js.*
